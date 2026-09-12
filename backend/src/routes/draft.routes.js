import { Router } from 'express';
import crypto from 'node:crypto';
import { query, withTransaction } from '../config/db.js';
import { requireAdmin } from '../middleware/auth.js';
import { getDraftBoard, turnTeamIndex } from '../services/draft.service.js';

// Драфт капитанов турнира (см. db/migrations/002_draft.sql и
// draft.service.js за деталями формулы змейки). Роутер монтируется в
// index.js на "/api" (не "/api/tournaments") — тем же приёмом, что и
// groups.routes.js/bracket.routes.js — т.к. нужны и пути
// "/tournaments/:id/draft...", и не привязанные к турниру
// "/draft/captain/:token..." (капитан заходит по токену, без id турнира в урле).

const router = Router();

function pickError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

// Проводит сам пик (создаёт team_players + draft_picks, при исчерпании пула
// закрывает драфт) — общая логика для пика капитаном по токену и
// админ-пика "за капитана". tx — клиент внутри транзакции.
async function performPick(tx, { draftId, tournamentId, teamId, playerId, teamsCount, pickedBy }) {
  const { rows: locked } = await tx.query('SELECT status FROM drafts WHERE id = $1 FOR UPDATE', [draftId]);
  if (!locked.length || locked[0].status !== 'active') throw pickError('Драфт уже завершён или сброшен', 409);
  const { rows: pickCountRows } = await tx.query('SELECT COUNT(*)::int AS c FROM draft_picks WHERE draft_id = $1', [
    draftId,
  ]);
  const pickCount = pickCountRows[0].c;

  const { rows: orderedTeams } = await tx.query(
    'SELECT team_id FROM draft_teams WHERE draft_id = $1 ORDER BY seed_order',
    [draftId]
  );
  const turnIndex = turnTeamIndex(pickCount, teamsCount);
  const teamOnTheClock = orderedTeams[turnIndex]?.team_id;
  if (teamOnTheClock !== teamId) {
    throw pickError('Сейчас не ваш ход', 409);
  }

  const teamIds = orderedTeams.map((t) => t.team_id);
  const { rows: availRows } = await tx.query(
    `SELECT p.id FROM tournament_players tp
     JOIN players p ON p.id = tp.player_id
     WHERE tp.tournament_id = $1 AND p.id = $2
       AND p.id NOT IN (SELECT player_id FROM team_players WHERE team_id = ANY($3::uuid[]))`,
    [tournamentId, playerId, teamIds]
  );
  if (availRows.length === 0) {
    throw pickError('Этот игрок недоступен для выбора (уже выбран или не зарегистрирован)', 400);
  }

  await tx.query('INSERT INTO team_players (team_id, player_id, is_captain) VALUES ($1, $2, false)', [
    teamId,
    playerId,
  ]);
  await tx.query(
    'INSERT INTO draft_picks (draft_id, pick_index, team_id, player_id, picked_by) VALUES ($1, $2, $3, $4, $5)',
    [draftId, pickCount, teamId, playerId, pickedBy]
  );

  const { rows: remainingRows } = await tx.query(
    `SELECT COUNT(*)::int AS c FROM tournament_players tp
     WHERE tp.tournament_id = $1
       AND tp.player_id NOT IN (SELECT player_id FROM team_players WHERE team_id = ANY($2::uuid[]))`,
    [tournamentId, teamIds]
  );
  if (remainingRows[0].c === 0) {
    await tx.query("UPDATE drafts SET status = 'finished', updated_at = now() WHERE id = $1", [draftId]);
  }
}

// GET /api/tournaments/:id/draft — публично: полная доска драфта (или null,
// если драфт для турнира ещё не запускали).
router.get('/tournaments/:id/draft', async (req, res) => {
  try {
    const data = await getDraftBoard(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/draft/captain/:token — доска + свой team_id для капитанской
// страницы (доступ без логина — по секретному токену из ссылки).
router.get('/draft/captain/:token', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT dt.team_id, dt.draft_id, d.tournament_id, t.name AS tournament_name
       FROM draft_teams dt
       JOIN drafts d ON d.id = dt.draft_id
       JOIN tournaments t ON t.id = d.tournament_id
       WHERE dt.pick_token = $1`,
      [req.params.token]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Ссылка недействительна' });

    const board = await getDraftBoard(rows[0].tournament_id);
    res.json({
      success: true,
      data: { ...board, my_team_id: rows[0].team_id, tournament_name: rows[0].tournament_name },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/draft/captain/:token/pick — капитан выбирает игрока (только
// когда сейчас его ход — проверяется внутри performPick).
router.post('/draft/captain/:token/pick', async (req, res) => {
  try {
    const { player_id } = req.body;
    if (!player_id) return res.status(400).json({ success: false, error: 'Не указан игрок' });

    await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT dt.team_id, dt.draft_id, d.tournament_id, d.teams_count, d.status
         FROM draft_teams dt
         JOIN drafts d ON d.id = dt.draft_id
         WHERE dt.pick_token = $1`,
        [req.params.token]
      );
      if (rows.length === 0) throw pickError('Ссылка недействительна', 404);
      const dt = rows[0];
      if (dt.status !== 'active') throw pickError('Драфт уже завершён', 409);

      await performPick(tx, {
        draftId: dt.draft_id,
        tournamentId: dt.tournament_id,
        teamId: dt.team_id,
        playerId: player_id,
        teamsCount: dt.teams_count,
        pickedBy: 'captain',
      });
    });

    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// ===================== АДМИНСКИЕ ЭНДПОИНТЫ =====================

// POST /api/tournaments/:id/draft/start — запустить драфт: топ-N
// зарегистрированных игроков по seed elo становятся капитанами и получают
// команды (создаются здесь же), у каждого — своя ссылка для пиков.
router.post('/tournaments/:id/draft/start', requireAdmin, async (req, res) => {
  try {
    const teamsCount = Number(req.body.teams_count);
    if (!Number.isInteger(teamsCount) || teamsCount < 2) {
      return res.status(400).json({ success: false, error: 'Укажите количество команд (минимум 2)' });
    }

    const result = await withTransaction(async (tx) => {
      const { rows: existingDraft } = await tx.query('SELECT id FROM drafts WHERE tournament_id = $1', [
        req.params.id,
      ]);
      if (existingDraft.length > 0) {
        throw pickError('Драфт для этого турнира уже запущен — сначала сбросьте его', 409);
      }

      const { rows: existingTeams } = await tx.query('SELECT id FROM teams WHERE tournament_id = $1', [
        req.params.id,
      ]);
      if (existingTeams.length > 0) {
        throw pickError('У турнира уже есть команды — драфт формирует составы с нуля, удалите существующие команды', 409);
      }

      // Тот же порядок, что и в "Рейтинге турнира" — по seed elo (FACEIT),
      // это и есть посев для выбора капитанов.
      const { rows: players } = await tx.query(
        `SELECT p.id, p.nickname, tp.seed_rating
         FROM tournament_players tp
         JOIN players p ON p.id = tp.player_id
         WHERE tp.tournament_id = $1
         ORDER BY tp.seed_rating DESC NULLS LAST, p.rating DESC`,
        [req.params.id]
      );
      if (players.length < teamsCount) {
        throw pickError(
          `Недостаточно зарегистрированных игроков (${players.length}) для ${teamsCount} команд`,
          400
        );
      }

      const captains = players.slice(0, teamsCount);
      // seed_order 0 = самый слабый капитан по elo — он пикает первым
      // (см. draft.service.js turnTeamIndex).
      const captainsAsc = [...captains].sort(
        (a, b) => (Number(a.seed_rating) || 0) - (Number(b.seed_rating) || 0)
      );

      const { rows: draftRows } = await tx.query(
        'INSERT INTO drafts (tournament_id, teams_count) VALUES ($1, $2) RETURNING *',
        [req.params.id, teamsCount]
      );
      const draft = draftRows[0];

      const links = [];
      for (let i = 0; i < captainsAsc.length; i++) {
        const cap = captainsAsc[i];
        const { rows: teamRows } = await tx.query(
          'INSERT INTO teams (tournament_id, name) VALUES ($1, $2) RETURNING *',
          [req.params.id, `Команда ${cap.nickname}`]
        );
        const team = teamRows[0];
        await tx.query('INSERT INTO team_players (team_id, player_id, is_captain) VALUES ($1, $2, true)', [
          team.id,
          cap.id,
        ]);
        const token = crypto.randomBytes(16).toString('hex');
        await tx.query(
          'INSERT INTO draft_teams (draft_id, team_id, captain_id, seed_order, pick_token) VALUES ($1, $2, $3, $4, $5)',
          [draft.id, team.id, cap.id, i, token]
        );
        links.push({ team_id: team.id, team_name: team.name, captain_nickname: cap.nickname, pick_token: token });
      }

      return links;
    });

    const board = await getDraftBoard(req.params.id);
    res.status(201).json({ success: true, data: { ...board, links: result } });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// GET /api/tournaments/:id/draft/links — админ-онли: ссылки капитанов для
// рассылки. Единственное (кроме ответа /start) место, где отдаётся
// pick_token — публичная доска его намеренно не содержит (см.
// draft.service.js). Нужно на случай, если админ обновил страницу/закрыл
// вкладку сразу после запуска драфта и не успел скопировать все ссылки.
router.get('/tournaments/:id/draft/links', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT dt.team_id, dt.pick_token, t.name AS team_name, p.nickname AS captain_nickname
       FROM draft_teams dt
       JOIN drafts d ON d.id = dt.draft_id
       JOIN teams t ON t.id = dt.team_id
       JOIN players p ON p.id = dt.captain_id
       WHERE d.tournament_id = $1
       ORDER BY dt.seed_order`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/tournaments/:id/draft — сбросить драфт: удаляет драфт и
// СОЗДАННЫЕ ИМ команды целиком (капитаны и пики исчезают вместе с ними).
// Если по этим командам уже создан матч — упадёт с ошибкой (у matches нет
// ON DELETE CASCADE на team_id) — тогда сначала нужно удалить сами матчи.
router.delete('/tournaments/:id/draft', requireAdmin, async (req, res) => {
  try {
    const deleted = await withTransaction(async (tx) => {
      const { rows: draftRows } = await tx.query('SELECT id FROM drafts WHERE tournament_id = $1', [
        req.params.id,
      ]);
      if (draftRows.length === 0) return false;
      const draftId = draftRows[0].id;

      const { rows: teamRows } = await tx.query('SELECT team_id FROM draft_teams WHERE draft_id = $1', [draftId]);
      await tx.query('DELETE FROM drafts WHERE id = $1', [draftId]); // каскадом уносит draft_teams/draft_picks

      const teamIds = teamRows.map((r) => r.team_id);
      if (teamIds.length > 0) {
        await tx.query('DELETE FROM teams WHERE id = ANY($1::uuid[])', [teamIds]); // каскадом уносит team_players
      }
      return true;
    });

    if (!deleted) return res.status(404).json({ success: false, error: 'Драфт не найден' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Не удалось сбросить драфт (возможно, по его командам уже создан матч — удалите матч и повторите): ' + err.message,
    });
  }
});

// PUT /api/tournaments/:id/draft/admin-pick — админ пикает за капитана
// (капитан недоступен/не разобрался со ссылкой и т.п.) — та же проверка
// хода, что и у обычного пика.
router.put('/tournaments/:id/draft/admin-pick', requireAdmin, async (req, res) => {
  try {
    const { team_id, player_id } = req.body;
    if (!team_id || !player_id) {
      return res.status(400).json({ success: false, error: 'Укажите team_id и player_id' });
    }

    await withTransaction(async (tx) => {
      const { rows: draftRows } = await tx.query('SELECT * FROM drafts WHERE tournament_id = $1', [
        req.params.id,
      ]);
      if (draftRows.length === 0) throw pickError('Драфт не найден', 404);
      const draft = draftRows[0];
      if (draft.status !== 'active') throw pickError('Драфт уже завершён', 409);

      await performPick(tx, {
        draftId: draft.id,
        tournamentId: req.params.id,
        teamId: team_id,
        playerId: player_id,
        teamsCount: draft.teams_count,
        pickedBy: 'admin',
      });
    });

    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

router.put('/tournaments/:id/draft/picks/:pickIndex', requireAdmin, async (req, res) => {
  try {
    const index = Number(req.params.pickIndex);
    const { player_id, expected_player_id } = req.body;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!Number.isSafeInteger(index) || index < 0 || !uuid.test(player_id || '') || !uuid.test(expected_player_id || '')) {
      throw pickError('Укажите номер пика и игроков', 400);
    }
    await withTransaction(async (tx) => {
      const { rows: drafts } = await tx.query('SELECT * FROM drafts WHERE tournament_id = $1 FOR UPDATE', [req.params.id]);
      const draft = drafts[0];
      if (!draft) throw pickError('Драфт не найден', 404);
      const { rows: picks } = await tx.query('SELECT * FROM draft_picks WHERE draft_id = $1 AND pick_index = $2', [draft.id, index]);
      const pick = picks[0];
      if (!pick) throw pickError('Пик не найден', 404);
      if (pick.player_id !== expected_player_id.toLowerCase()) throw pickError('Пик уже изменён другим администратором. Обновите страницу.', 409);
      const { rows: available } = await tx.query(
        `SELECT player_id FROM tournament_players WHERE tournament_id = $1 AND player_id = $2
         AND NOT EXISTS (SELECT 1 FROM team_players tp JOIN draft_teams dt ON dt.team_id = tp.team_id
           WHERE dt.draft_id = $3 AND tp.player_id = $2)`, [req.params.id, player_id, draft.id]);
      if (!available.length) throw pickError('Игрок уже выбран или не зарегистрирован в турнире', 409);
      const { rowCount } = await tx.query('DELETE FROM team_players WHERE team_id = $1 AND player_id = $2 AND is_captain = false', [pick.team_id, pick.player_id]);
      if (rowCount !== 1) throw pickError('Состав изменился: заменять можно только обычный пик, не капитана', 409);
      await tx.query('INSERT INTO team_players (team_id, player_id, is_captain) VALUES ($1, $2, false)', [pick.team_id, player_id]);
      await tx.query('UPDATE draft_picks SET player_id = $1, picked_by = $2 WHERE id = $3', [player_id, 'admin', pick.id]);
      await tx.query('UPDATE drafts SET updated_at = now() WHERE id = $1', [draft.id]);
    });
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

router.delete('/tournaments/:id/draft/picks/:pickIndex', requireAdmin, async (req, res) => {
  try {
    const index = Number(req.params.pickIndex);
    const expected = req.body.expected_player_id;
    if (!Number.isSafeInteger(index) || index < 0 || typeof expected !== 'string') {
      throw pickError('Укажите номер пика и игрока', 400);
    }
    await withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT * FROM drafts WHERE tournament_id = $1 FOR UPDATE', [req.params.id]);
      const draft = rows[0];
      if (!draft) throw pickError('Драфт не найден', 404);
      if (draft.status !== 'finished') throw pickError('Удаление доступно только после завершения драфта', 409);
      const { rows: picks } = await tx.query('SELECT * FROM draft_picks WHERE draft_id = $1 AND pick_index = $2', [draft.id, index]);
      const pick = picks[0];
      if (!pick) throw pickError('Пик уже удалён', 404);
      if (pick.player_id !== expected.toLowerCase()) throw pickError('Игрок в этом пике изменился. Обновите страницу.', 409);
      const { rowCount } = await tx.query('DELETE FROM team_players WHERE team_id = $1 AND player_id = $2 AND is_captain = false', [pick.team_id, pick.player_id]);
      if (rowCount !== 1) throw pickError('Игрок отсутствует в составе или является капитаном', 409);
      await tx.query('DELETE FROM draft_picks WHERE id = $1', [pick.id]);
      await tx.query('UPDATE drafts SET updated_at = now() WHERE id = $1', [draft.id]);
    });
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

export default router;
