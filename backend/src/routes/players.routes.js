import { teamEloSql } from '../services/teamElo.sql.js';
import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

// GET /api/players?search=nick — поиск/список игроков клуба
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    const { rows } = search
      ? await query('SELECT * FROM players WHERE nickname ILIKE $1 ORDER BY rating DESC LIMIT 50', [`%${search}%`])
      : await query('SELECT * FROM players ORDER BY rating DESC LIMIT 100');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/players/:id — профиль игрока + история матчей + история рейтинга
router.get('/:id', async (req, res) => {
  try {
    const { rows: playerRows } = await query('SELECT * FROM players WHERE id = $1', [req.params.id]);
    if (playerRows.length === 0) return res.status(404).json({ success: false, error: 'Игрок не найден' });

    const { rows: history } = await query(
      `SELECT prh.*, m.map, m.tournament_id, t.name AS tournament_name
       FROM player_rating_history prh
       LEFT JOIN matches m ON m.id = prh.match_id
       LEFT JOIN tournaments t ON t.id = m.tournament_id
       WHERE prh.player_id = $1
       ORDER BY prh.created_at ASC`,
      [req.params.id]
    );

    const { rows: matchStats } = await query(
      `SELECT mps.*, m.map, m.played_at, ta.name AS team_a_name, tb.name AS team_b_name, ${teamEloSql('ta')} AS team_a_average_elo, ${teamEloSql('tb')} AS team_b_average_elo
       FROM match_player_stats mps
       JOIN matches m ON m.id = mps.match_id
       LEFT JOIN teams ta ON ta.id = m.team_a_id
       LEFT JOIN teams tb ON tb.id = m.team_b_id
       WHERE mps.player_id = $1
       ORDER BY m.played_at DESC NULLS LAST`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...playerRows[0], rating_history: history, match_stats: matchStats } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
