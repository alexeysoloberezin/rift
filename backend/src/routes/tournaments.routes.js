import { teamEloSql } from '../services/teamElo.sql.js';
import { Router } from 'express';
import multer from 'multer';
import { query, withTransaction } from '../config/db.js';
import { requireAdmin } from '../middleware/auth.js';
import { parsePlayersExcel, upsertTournamentPlayers } from '../services/excelImport.service.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// GET /api/tournaments — публичный список турниров
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM tournament_players tp WHERE tp.tournament_id = t.id) AS players_count,
              (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id) AS matches_count
       FROM tournaments t
       ORDER BY t.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/tournaments/:id — детали турнира: инфо + команды + матчи
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: tRows } = await query('SELECT * FROM tournaments WHERE id = $1', [id]);
    if (tRows.length === 0) return res.status(404).json({ success: false, error: 'Турнир не найден' });

    // seed_rating (elo с FACEIT на момент регистрации) тянем отдельным LEFT
    // JOIN на tournament_players — это турнирно-специфичное поле, его нет в
    // самой players, только в привязке игрока к конкретному турниру. Нужно
    // фронту, чтобы показать уровень FACEIT в составах команд (см.
    // frontend/src/lib/faceit.js).
    const { rows: teams } = await query(
      `SELECT tm.*, ${teamEloSql('tm')} AS average_elo, COALESCE(json_agg(json_build_object(
          'player_id', p.id, 'nickname', p.nickname, 'rating', p.rating, 'is_captain', tp.is_captain,
          'seed_rating', tpx.seed_rating
        )) FILTER (WHERE p.id IS NOT NULL), '[]') AS players
       FROM teams tm
       LEFT JOIN team_players tp ON tp.team_id = tm.id
       LEFT JOIN players p ON p.id = tp.player_id
       LEFT JOIN tournament_players tpx ON tpx.tournament_id = tm.tournament_id AND tpx.player_id = p.id
       WHERE tm.tournament_id = $1
       GROUP BY tm.id
       ORDER BY tm.created_at`,
      [id]
    );

    const { rows: matches } = await query(
      `SELECT m.*, (SELECT updated_at FROM match_screenshots WHERE match_id = m.id) AS screenshot_version, ta.name AS team_a_name, tb.name AS team_b_name, ${teamEloSql('ta')} AS team_a_average_elo, ${teamEloSql('tb')} AS team_b_average_elo
       FROM matches m
       LEFT JOIN teams ta ON ta.id = m.team_a_id
       LEFT JOIN teams tb ON tb.id = m.team_b_id
       WHERE m.tournament_id = $1
       ORDER BY m.created_at`,
      [id]
    );

    res.json({ success: true, data: { ...tRows[0], teams, matches } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/tournaments/:id/players — список зарегистрированных игроков турнира
router.get('/:id/players', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT tp.*, p.nickname, p.rating, p.telegram, p.faceit_link, p.avatar_url
       FROM tournament_players tp
       JOIN players p ON p.id = tp.player_id
       WHERE tp.tournament_id = $1
       ORDER BY tp.seed_rating DESC NULLS LAST`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/tournaments/:id/leaderboard — рейтинг игроков турнира по итогам сыгранных матчей
router.get('/:id/leaderboard', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT p.id, p.nickname, p.avatar_url, p.rating, tp.seed_rating,
              COUNT(mps.id)::int AS matches_played,
              ROUND(AVG(mps.match_rating)::numeric, 3) AS avg_match_rating,
              SUM(mps.elo_change) AS total_elo_change
       FROM tournament_players tp
       JOIN players p ON p.id = tp.player_id
       LEFT JOIN match_player_stats mps ON mps.player_id = p.id
         AND mps.match_id IN (SELECT id FROM matches WHERE tournament_id = $1)
       WHERE tp.tournament_id = $1
       GROUP BY p.id, tp.seed_rating
       -- Пока по турниру не сыграно ни одного матча, p.rating у всех
       -- одинаковый (клубный ELO ещё не менялся) — сортировать по нему
       -- бессмысленно. seed_rating (FACEIT elo, указанный при регистрации)
       -- в этот момент куда информативнее, поэтому сортируем по нему первым,
       -- а по факту сыгранных матчей — уже как выравнивающий признак.
       ORDER BY tp.seed_rating DESC NULLS LAST, p.rating DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== АДМИНСКИЕ ЭНДПОИНТЫ =====================

// POST /api/tournaments — создать турнир
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description, format, start_date, end_date } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Укажите название турнира' });

    const { rows } = await query(
      `INSERT INTO tournaments (name, description, format, start_date, end_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, description || null, format || null, start_date || null, end_date || null, req.admin.id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/tournaments/:id — обновить турнир (статус, описание и т.д.)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, description, format, status, start_date, end_date } = req.body;
    const { rows } = await query(
      `UPDATE tournaments SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         format = COALESCE($3, format),
         status = COALESCE($4, status),
         start_date = COALESCE($5, start_date),
         end_date = COALESCE($6, end_date),
         updated_at = now()
       WHERE id = $7 RETURNING *`,
      [name, description, format, status, start_date, end_date, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Турнир не найден' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tournaments/:id/import-players — импорт списка игроков из Excel
// multipart/form-data, поле файла: "file"
router.post('/:id/import-players', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Файл не передан (поле "file")' });

    const { players, warnings } = parsePlayersExcel(req.file.buffer);
    if (players.length === 0) {
      return res.status(400).json({ success: false, error: 'Не удалось извлечь ни одного игрока из файла', warnings });
    }

    const tournamentId = req.params.id;
    const result = await withTransaction((tx) => upsertTournamentPlayers(tx, tournamentId, players));

    res.json({ success: true, imported_count: result.length, warnings, data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tournaments/:id/players — вручную добавить одного игрока в
// список зарегистрированных турнира (без Excel/Google Sheets) — например,
// кто-то зарегистрировался организатору лично. Переиспользует ту же логику
// резолва/апсерта, что и импорт (см. excelImport.service.js): игрок ищется
// по нику/faceit-ссылке среди уже существующих в клубе, при совпадении не
// создаётся дубль, только обновляются его поля и привязка к турниру.
router.post('/:id/players', requireAdmin, async (req, res) => {
  try {
    const { nickname, telegram, faceit_link, seed_rating, hours_cs2 } = req.body;
    if (!nickname || !String(nickname).trim()) {
      return res.status(400).json({ success: false, error: 'Укажите ник игрока' });
    }

    const row = {
      date: null,
      name: null,
      telegram: telegram ? String(telegram).trim() : null,
      nickname: String(nickname).trim(),
      faceit_link: faceit_link ? String(faceit_link).trim() : null,
      elo_raw: seed_rating !== undefined && seed_rating !== null && seed_rating !== '' ? Number(seed_rating) : null,
      hours: hours_cs2 !== undefined && hours_cs2 !== null && hours_cs2 !== '' ? Number(hours_cs2) : null,
      raw_row: { source: 'Добавлено вручную админом' },
    };

    const result = await withTransaction((tx) => upsertTournamentPlayers(tx, req.params.id, [row]));
    const addedPlayerId = result[0].player.id;

    const { rows: joined } = await query(
      `SELECT tp.*, p.nickname, p.rating, p.telegram, p.faceit_link, p.avatar_url
       FROM tournament_players tp
       JOIN players p ON p.id = tp.player_id
       WHERE tp.tournament_id = $1 AND tp.player_id = $2`,
      [req.params.id, addedPlayerId]
    );

    res.status(201).json({ success: true, data: joined[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/tournaments/:id/players/:playerId/confirm — переключить статус
// подтверждения участия ("подтвердил / не подтвердил"). Отдельный лёгкий
// эндпоинт (а не через общий PUT ниже), чтобы в таблице это был один клик по
// статусу без открытия формы редактирования. Импорт из Excel/автосинк из
// Google Sheets это поле не трогают (см. upsertTournamentPlayers) — так что
// повторная загрузка списка не сбрасывает уже проставленные статусы.
router.put('/:id/players/:playerId/confirm', requireAdmin, async (req, res) => {
  try {
    const { confirmed } = req.body;
    const { rows } = await query(
      `UPDATE tournament_players SET confirmed = $1
       WHERE tournament_id = $2 AND player_id = $3
       RETURNING *`,
      [Boolean(confirmed), req.params.id, req.params.playerId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Игрок не зарегистрирован в этом турнире' });
    }

    const { rows: joined } = await query(
      `SELECT tp.*, p.nickname, p.rating, p.telegram, p.faceit_link, p.avatar_url
       FROM tournament_players tp
       JOIN players p ON p.id = tp.player_id
       WHERE tp.tournament_id = $1 AND tp.player_id = $2`,
      [req.params.id, req.params.playerId]
    );
    res.json({ success: true, data: joined[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/tournaments/:id/players/:playerId — админ правит поля игрока
// ПОСЛЕ импорта (ник/телеграм/faceit — общие для игрока поля в players;
// seed elo/часы — специфичные для этого турнира поля в tournament_players).
// Нужно на случай, если Excel/форма дали кривые данные (опечатка в нике,
// ссылка на faceit без https и т.п.) — руками через импорт заново гонять
// весь список ради одной строки неудобно.
router.put('/:id/players/:playerId', requireAdmin, async (req, res) => {
  try {
    const { nickname, telegram, faceit_link, seed_rating, hours_cs2 } = req.body;

    const result = await withTransaction(async (tx) => {
      const { rows: tpRows } = await tx.query(
        'SELECT * FROM tournament_players WHERE tournament_id = $1 AND player_id = $2',
        [req.params.id, req.params.playerId]
      );
      if (tpRows.length === 0) return null;

      if (nickname !== undefined || telegram !== undefined || faceit_link !== undefined) {
        if (nickname !== undefined && !String(nickname).trim()) {
          throw Object.assign(new Error('Ник не может быть пустым'), { statusCode: 400 });
        }
        await tx.query(
          `UPDATE players SET
             nickname = COALESCE($1, nickname),
             telegram = COALESCE($2, telegram),
             faceit_link = COALESCE($3, faceit_link),
             updated_at = now()
           WHERE id = $4`,
          [nickname?.trim(), telegram, faceit_link, req.params.playerId]
        );
      }

      const { rows: updatedTp } = await tx.query(
        `UPDATE tournament_players SET
           seed_rating = COALESCE($1, seed_rating),
           hours_cs2 = COALESCE($2, hours_cs2)
         WHERE tournament_id = $3 AND player_id = $4
         RETURNING *`,
        [seed_rating, hours_cs2, req.params.id, req.params.playerId]
      );

      const { rows: joined } = await tx.query(
        `SELECT tp.*, p.nickname, p.rating, p.telegram, p.faceit_link, p.avatar_url
         FROM tournament_players tp
         JOIN players p ON p.id = tp.player_id
         WHERE tp.tournament_id = $1 AND tp.player_id = $2`,
        [req.params.id, req.params.playerId]
      );
      return joined[0] || updatedTp[0];
    });

    if (result === null) {
      return res.status(404).json({ success: false, error: 'Игрок не зарегистрирован в этом турнире' });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// DELETE /api/tournaments/:id/players/:playerId — убрать игрока из списка
// зарегистрированных (например, попал в Excel/Google-таблицу по ошибке, или
// зарегистрировался дважды под разными никами). Не трогает глобальный
// профиль players — только привязку к этому турниру.
// Блокируем удаление, если игрок уже в составе команды этого турнира —
// иначе список "зарегистрированных" разъедется с фактическими составами
// (сначала нужно убрать его из команды).
router.delete('/:id/players/:playerId', requireAdmin, async (req, res) => {
  try {
    const { id, playerId } = req.params;

    const { rows: onTeam } = await query(
      `SELECT tm.name FROM team_players tp
       JOIN teams tm ON tm.id = tp.team_id
       WHERE tm.tournament_id = $1 AND tp.player_id = $2
       LIMIT 1`,
      [id, playerId]
    );
    if (onTeam.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Игрок уже в составе команды «${onTeam[0].name}» — сначала уберите его из команды`,
      });
    }

    const { rowCount } = await query(
      'DELETE FROM tournament_players WHERE tournament_id = $1 AND player_id = $2',
      [id, playerId]
    );
    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Игрок не зарегистрирован в этом турнире' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/tournaments/:id/sheet-source — настроить автосинк списка игроков
// из живой Google-таблицы (вместо разовой ручной загрузки .xlsx). Сама
// синхронизация идёт фоновым поллером — см. services/sheetSync.service.js.
router.put('/:id/sheet-source', requireAdmin, async (req, res) => {
  try {
    const { sheet_id, sheet_range, sheet_sync_enabled } = req.body;
    const { rows } = await query(
      `UPDATE tournaments SET
         sheet_id = $1, sheet_range = $2, sheet_sync_enabled = $3, sheet_last_sync_error = NULL
       WHERE id = $4 RETURNING *`,
      [sheet_id || null, sheet_range || 'A:Z', Boolean(sheet_sync_enabled), req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Турнир не найден' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tournaments/:id/teams — создать команду в турнире
router.post('/:id/teams', requireAdmin, async (req, res) => {
  try {
    const { name, tag, captain_name, player_ids = [] } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Укажите название команды' });
    if (captain_name != null && (typeof captain_name !== 'string' || captain_name.length > 128)) {
      return res.status(400).json({ success: false, error: 'Ник капитана должен быть строкой до 128 символов' });
    }

    const result = await withTransaction(async (tx) => {
      const { rows: teamRows } = await tx.query(
        `INSERT INTO teams (tournament_id, name, tag, captain_name) VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.params.id, name, tag || null, captain_name?.trim() || null]
      );
      const team = teamRows[0];

      for (const playerId of player_ids) {
        await tx.query(
          `INSERT INTO team_players (team_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [team.id, playerId]
        );
      }
      return team;
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err.constraint === 'teams_tournament_captain_name_unique') {
      return res.status(409).json({ success: false, error: 'Команда с таким ником капитана уже есть в турнире' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id/teams/:teamId/captain', requireAdmin, async (req, res) => {
  const { captain_name } = req.body;
  if (typeof captain_name !== 'string' || captain_name.length > 128) {
    return res.status(400).json({ success: false, error: 'Ник капитана должен быть строкой до 128 символов' });
  }
  try {
    const { rows } = await query(
      'UPDATE teams SET captain_name = $1 WHERE id = $2 AND tournament_id = $3 RETURNING *',
      [captain_name.trim() || null, req.params.teamId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Команда не найдена' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    if (err.constraint === 'teams_tournament_captain_name_unique') {
      return res.status(409).json({ success: false, error: 'Команда с таким ником капитана уже есть в турнире' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id/teams/:teamId', requireAdmin, async (req, res) => {
  try {
    await withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT id FROM teams WHERE id = $1 AND tournament_id = $2 FOR UPDATE',
        [req.params.teamId, req.params.id]);
      if (!rows.length) throw Object.assign(new Error('Команда не найдена'), { statusCode: 404 });
      const { rows: links } = await tx.query(
        `SELECT 1 FROM matches WHERE team_a_id = $1 OR team_b_id = $1
         UNION ALL SELECT 1 FROM match_player_stats WHERE team_id = $1
         UNION ALL SELECT 1 FROM draft_teams WHERE team_id = $1
         UNION ALL SELECT 1 FROM draft_picks WHERE team_id = $1 LIMIT 1`, [req.params.teamId]);
      if (links.length) throw Object.assign(new Error('Команда используется в матчах или драфте. Сначала замените её в матчах или сбросьте связанный драфт.'), { statusCode: 409 });
      await tx.query('DELETE FROM teams WHERE id = $1', [req.params.teamId]);
    });
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || (err.code === '23503' ? 409 : 500)).json({ success: false, error: err.code === '23503' ? 'Команда используется. Обновите страницу и проверьте её связи.' : err.message });
  }
});

export default router;
