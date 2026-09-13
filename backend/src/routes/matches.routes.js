import { teamEloSql } from '../services/teamElo.sql.js';
import { Router } from 'express';
import fs from 'node:fs';
import { query, withTransaction } from '../config/db.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

// Этот роутер монтируется в index.js на "/api" (не "/api/matches"), т.к. ему
// нужны как пути "/matches/:id", так и "/tournaments/:id/matches".

// GET /api/matches/:id — детали матча + статистика игроков
router.get('/matches/:id', async (req, res) => {
  try {
    const { rows: matchRows } = await query(
      `SELECT m.*, (SELECT updated_at FROM match_screenshots WHERE match_id = m.id) AS screenshot_version, ta.name AS team_a_name, tb.name AS team_b_name, ${teamEloSql('ta')} AS team_a_average_elo, ${teamEloSql('tb')} AS team_b_average_elo
       FROM matches m
       LEFT JOIN teams ta ON ta.id = m.team_a_id
       LEFT JOIN teams tb ON tb.id = m.team_b_id
       WHERE m.id = $1`,
      [req.params.id]
    );
    if (matchRows.length === 0) return res.status(404).json({ success: false, error: 'Матч не найден' });

    const { rows: stats } = await query(
      // steam_id64 — чтобы фронт мог сматчить строку статистики с
      // "бонусными" статами по игроку (оружие/утилита/гранаты) из
      // demos.raw_stats.players[], где игроки идентифицированы по steam_id,
      // а не по внутреннему player_id.
      `SELECT mps.*, p.nickname, p.avatar_url, p.steam_id64
       FROM match_player_stats mps
       JOIN players p ON p.id = mps.player_id
       WHERE mps.match_id = $1
       ORDER BY mps.match_rating DESC NULLS LAST`,
      [req.params.id]
    );

    const { rows: demos } = await query(
      // raw_stats — весь разбор демки как есть (карта, тикрейт, длительность,
      // подробный лог по раундам и т.д., см. demo-parser/app/parser.py) —
      // отдаём как есть, фронт сам решает, что из этого показать.
      'SELECT id, original_name, status, error_message, uploaded_at, parsed_at, raw_stats FROM demos WHERE match_id = $1 ORDER BY uploaded_at DESC',
      [req.params.id]
    );

    res.json({ success: true, data: { ...matchRows[0], stats, demos } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tournaments/:tournamentId/matches — создать матч (админ)
router.post('/tournaments/:tournamentId/matches', requireAdmin, async (req, res) => {
  try {
    const { team_a_id, team_b_id, map, best_of, round_number, played_at } = req.body;
    // Реальный кейс: при создании матча в обоих выпадающих списках выбрали
    // одну и ту же команду — на странице матча в обеих колонках показывался
    // один и тот же полный состав из 10 игроков. Раньше эта проверка стояла
    // только в PUT (редактирование) — теперь и здесь, чтобы это вообще
    // нельзя было создать.
    if (team_a_id && team_b_id && team_a_id === team_b_id) {
      return res
        .status(400)
        .json({ success: false, error: 'team_a_id и team_b_id не могут указывать на одну и ту же команду' });
    }
    // Привязка к группе/плей-офф слоту сюда намеренно не входит — при
    // создании матч ни к чему не привязан. Админ указывает, куда матч
    // относится (группа/полуфинал/финал), отдельно — см. PUT /matches/:id/stage
    // ниже, уже после того как матч создан.
    const { rows } = await query(
      `INSERT INTO matches (tournament_id, team_a_id, team_b_id, map, best_of, round_number, played_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        req.params.tournamentId,
        team_a_id || null,
        team_b_id || null,
        map || null,
        best_of || 1,
        round_number || null,
        played_at || null,
      ]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/matches/:id — обновить матч вручную (счёт, статус, составы) — на
// случай, если демки нет, или если при создании матча перепутали команды
// (team_a_id/team_b_id указывают на одну и ту же команду — тогда на странице
// матча в обеих колонках показывается один и тот же полный состав).
router.put('/matches/:id', requireAdmin, async (req, res) => {
  try {
    const { map, score_a, score_b, status, played_at, team_a_id, team_b_id } = req.body;
    if ([score_a, score_b].some(score => score != null && (!Number.isInteger(score) || score < 0 || score > 1000))) {
      return res.status(400).json({ success: false, error: 'Счёт должен быть целым числом от 0 до 1000' });
    }
    if (team_a_id && team_b_id && team_a_id === team_b_id) {
      return res
        .status(400)
        .json({ success: false, error: 'team_a_id и team_b_id не могут указывать на одну и ту же команду' });
    }
    const { rows } = await query(
      `UPDATE matches SET
         map = COALESCE($1, map), score_a = COALESCE($2, score_a), score_b = COALESCE($3, score_b),
         score_manually_set = CASE WHEN $2::integer IS NOT NULL OR $3::integer IS NOT NULL THEN true ELSE score_manually_set END,
         status = COALESCE($4, CASE WHEN COALESCE($2, score_a) IS NOT NULL AND COALESCE($3, score_b) IS NOT NULL AND status IN ('scheduled', 'needs_demo') THEN 'played' ELSE status END), played_at = COALESCE($5, played_at),
         team_a_id = COALESCE($6, team_a_id), team_b_id = COALESCE($7, team_b_id)
       WHERE id = $8 RETURNING *`,
      [map, score_a, score_b, status, played_at, team_a_id || null, team_b_id || null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Матч не найден' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/matches/:id/stage — админ указывает, к какому этапу турнира
// относится УЖЕ созданный матч: групповой этап (группа A/Б) или слот
// плей-офф (полуфинал 1/2, финал). Делается отдельно от создания/обычного
// редактирования матча — см. AdminTournamentManageView.vue.
//
// stage — одна из строк:
//   null                 — матч ни к чему не привязан (снять привязку)
//   "group:<uuid>"        — привязать к группе с этим id
//   "semifinal:0" | "semifinal:1" | "final:0" — привязать к слоту сетки
//
// Перед установкой новой привязки всегда снимаем старую (и group_id, и
// bracket_slots.match_id) — у матча может быть только одна привязка сразу,
// и без явной очистки при переносе матча из группы в сетку (или наоборот)
// осталась бы "хвостовая" привязка в другом месте.
router.put('/matches/:id/stage', requireAdmin, async (req, res) => {
  try {
    const { stage } = req.body;
    const result = await withTransaction(async (tx) => {
      const { rows: matchRows } = await tx.query('SELECT id, tournament_id FROM matches WHERE id = $1', [
        req.params.id,
      ]);
      if (matchRows.length === 0) return null;
      const match = matchRows[0];

      await tx.query('UPDATE matches SET group_id = NULL WHERE id = $1', [match.id]);
      await tx.query('UPDATE bracket_slots SET match_id = NULL, updated_at = now() WHERE match_id = $1', [
        match.id,
      ]);

      if (stage && stage.startsWith('group:')) {
        const groupId = stage.slice('group:'.length);
        await tx.query('UPDATE matches SET group_id = $1 WHERE id = $2', [groupId, match.id]);
      } else if (stage) {
        const [round, slotIndexStr] = stage.split(':');
        const slotIndex = Number(slotIndexStr);
        const { rowCount } = await tx.query(
          'UPDATE bracket_slots SET match_id = $1, updated_at = now() WHERE tournament_id = $2 AND round = $3 AND slot_index = $4',
          [match.id, match.tournament_id, round, slotIndex]
        );
        if (rowCount === 0) {
          throw Object.assign(new Error('Слот сетки не найден'), { statusCode: 400 });
        }
      }

      const { rows } = await tx.query('SELECT * FROM matches WHERE id = $1', [match.id]);
      return rows[0];
    });
    if (result === null) return res.status(404).json({ success: false, error: 'Матч не найден' });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// DELETE /api/matches/:id — удалить матч (админ).
//
// Помимо самой строки матча (демки и match_player_stats удалятся каскадом —
// см. ON DELETE CASCADE в схеме) нужно откатить то, что этот матч уже успел
// сделать с рейтингом игроков: если демка была обработана, players.rating
// и matches_played уже изменены. Просто удалить матч, оставив эти изменения
// висеть — значит навсегда исказить рейтинг несуществующим матчем.
//
// Оговорка: откат возвращает рейтинг игрока к elo_before ИМЕННО этого матча.
// Если после него у игрока уже были обработаны более поздние матчи, их эло
// считалось поверх уже применённого swing'а этого матча — откат не
// пересчитывает всю цепочку задним числом (это отдельная, более сложная
// операция). Для обычного случая — удаления неверно созданного/тестового
// матча вскоре после его обработки — этого достаточно.
router.delete('/matches/:id', requireAdmin, async (req, res) => {
  try {
    const result = await withTransaction(async (tx) => {
      const { rows: matchRows } = await tx.query('SELECT id FROM matches WHERE id = $1', [req.params.id]);
      if (matchRows.length === 0) return null;

      const { rows: statsRows } = await tx.query(
        'SELECT player_id, elo_before FROM match_player_stats WHERE match_id = $1',
        [req.params.id]
      );
      for (const s of statsRows.filter(row => row.elo_before != null)) {
        await tx.query(
          'UPDATE players SET rating = $1, matches_played = GREATEST(matches_played - 1, 0), updated_at = now() WHERE id = $2',
          [s.elo_before, s.player_id]
        );
      }

      const { rows: demoRows } = await tx.query('SELECT storage_path FROM demos WHERE match_id = $1', [
        req.params.id,
      ]);

      // Явно удаляем историю рейтинга (а не полагаемся на ON DELETE SET NULL
      // в схеме) — иначе после удаления матча остались бы записи истории,
      // ни к какому матчу больше не привязанные.
      await tx.query('DELETE FROM player_rating_history WHERE match_id = $1', [req.params.id]);
      await tx.query('DELETE FROM matches WHERE id = $1', [req.params.id]);

      return demoRows.map((d) => d.storage_path).filter(Boolean);
    });

    if (result === null) return res.status(404).json({ success: false, error: 'Матч не найден' });

    for (const filePath of result) {
      fs.unlink(filePath, () => {}); // если файла уже нет на диске — не критично
    }

    res.json({ success: true, message: 'Матч удалён' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Change both sides atomically, including existing player statistics.
router.put('/matches/:id/teams', requireAdmin, async (req, res) => {
  try {
    const { team_a_id: a, team_b_id: b } = req.body;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof a !== 'string' || typeof b !== 'string' || !uuid.test(a) || !uuid.test(b) || a.toLowerCase() === b.toLowerCase()) {
      return res.status(400).json({ success: false, error: 'Выберите две разные команды' });
    }
    const result = await withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [req.params.id]);
      const match = rows[0];
      if (!match) throw Object.assign(new Error('Матч не найден'), { statusCode: 404 });
      if (match.status === 'parsing_demo') throw Object.assign(new Error('Дождитесь завершения обработки демо'), { statusCode: 409 });
      const { rows: teams } = await tx.query('SELECT id FROM teams WHERE tournament_id = $1 AND id = ANY($2::uuid[]) FOR KEY SHARE', [match.tournament_id, [a, b]]);
      if (teams.length !== 2) throw Object.assign(new Error('Обе команды должны принадлежать турниру матча'), { statusCode: 400 });
      const { rows: ambiguous } = await tx.query(
        `SELECT 1 FROM match_player_stats WHERE match_id = $1 AND
          (team_id IS NULL OR team_id NOT IN (SELECT unnest($2::uuid[])) OR $3::boolean) LIMIT 1`,
        [match.id, [match.team_a_id, match.team_b_id].filter(Boolean), match.team_a_id === match.team_b_id]);
      if (ambiguous.length) throw Object.assign(new Error('Невозможно определить стороны сохранённой статистики. Сначала исправьте или повторно обработайте демо.'), { statusCode: 409 });
      await tx.query(`UPDATE match_player_stats SET team_id = CASE
        WHEN team_id = $2 THEN $4::uuid WHEN team_id = $3 THEN $5::uuid ELSE team_id END WHERE match_id = $1`,
        [match.id, match.team_a_id, match.team_b_id, a, b]);
      const { rows: updated } = await tx.query('UPDATE matches SET team_a_id = $1, team_b_id = $2, teams_manually_set = true WHERE id = $3 RETURNING *', [a, b, match.id]);
      await tx.query('UPDATE bracket_slots SET team_a_id = $1, team_b_id = $2, updated_at = now() WHERE match_id = $3', [a, b, match.id]);
      return updated[0];
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

export default router;
