import { teamEloSql } from '../services/teamElo.sql.js';
import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAdmin } from '../middleware/auth.js';

// Плей-офф сетка турнира: фиксированная форма "полуфинал (2 матча/4 команды)
// -> финал (1 матч/2 команды)" — см. db/migrations/001_groups_and_bracket.sql.
// Это чистая разметка: админ вручную расставляет команды по слотам и может
// привязать к слоту уже загруженный/обработанный матч как результат встречи.
// Автоматического проброса победителя полуфинала в финал нет — организатор
// решает это сам.
//
// Роутер монтируется в index.js на "/api" — та же схема, что у
// groups.routes.js/matches.routes.js: ему нужны и "/tournaments/:id/bracket...",
// и "/bracket-slots/:id".

const router = Router();

const SEMIFINAL_SLOTS = [0, 1];

function sortSlots(rows) {
  // Порядок раундов должен быть "полуфинал, потом финал" — на алфавит
  // полагаться нельзя ('final' < 'semifinal').
  return [...rows].sort((a, b) => {
    if (a.round !== b.round) return a.round === 'semifinal' ? -1 : 1;
    return a.slot_index - b.slot_index;
  });
}

// GET /api/tournaments/:tournamentId/bracket — публично: слоты сетки с
// именами команд и массивом матчей-карт, привязанных к серии.
router.get('/tournaments/:tournamentId/bracket', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT bs.*, ta.name AS team_a_name, tb.name AS team_b_name, ${teamEloSql('ta')} AS team_a_average_elo, ${teamEloSql('tb')} AS team_b_average_elo,
              COALESCE((SELECT json_agg(json_build_object(
                'id', m.id, 'status', m.status, 'score_a', m.score_a, 'score_b', m.score_b,
                'team_a_id', m.team_a_id, 'team_b_id', m.team_b_id,
                'map', m.map, 'created_at', m.created_at
              ) ORDER BY bsm.created_at, m.created_at)
              FROM bracket_slot_matches bsm JOIN matches m ON m.id = bsm.match_id
              WHERE bsm.slot_id = bs.id), '[]'::json) AS matches
       FROM bracket_slots bs
       LEFT JOIN teams ta ON ta.id = bs.team_a_id
       LEFT JOIN teams tb ON tb.id = bs.team_b_id
       WHERE bs.tournament_id = $1`,
      [req.params.tournamentId]
    );
    res.json({ success: true, data: sortSlots(rows) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== АДМИНСКИЕ ЭНДПОИНТЫ =====================

// POST /api/tournaments/:tournamentId/bracket/init — идемпотентно создать
// 3 пустых слота (2 полуфинала + финал), если их ещё нет.
router.post('/tournaments/:tournamentId/bracket/init', requireAdmin, async (req, res) => {
  try {
    const slots = [...SEMIFINAL_SLOTS.map((slot_index) => ({ round: 'semifinal', slot_index })), { round: 'final', slot_index: 0 }];
    for (const s of slots) {
      await query(
        `INSERT INTO bracket_slots (tournament_id, round, slot_index) VALUES ($1, $2, $3)
         ON CONFLICT (tournament_id, round, slot_index) DO NOTHING`,
        [req.params.tournamentId, s.round, s.slot_index]
      );
    }
    const { rows } = await query('SELECT * FROM bracket_slots WHERE tournament_id = $1', [req.params.tournamentId]);
    res.json({ success: true, data: sortSlots(rows) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/bracket-slots/:id — задать команды и при необходимости добавить
// ещё один матч в серию. Пустой match_id уже добавленные матчи не удаляет.
router.put('/bracket-slots/:id', requireAdmin, async (req, res) => {
  try {
    const { team_a_id, team_b_id, match_id } = req.body;
    if (team_a_id && team_b_id && team_a_id === team_b_id) {
      return res
        .status(400)
        .json({ success: false, error: 'Команда A и команда B не могут быть одной и той же командой' });
    }
    const { rows } = await query(
      `UPDATE bracket_slots SET team_a_id = $1, team_b_id = $2, updated_at = now()
       WHERE id = $3 RETURNING *`,
      [team_a_id || null, team_b_id || null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Слот сетки не найден' });
    // Backward compatible admin API: supplying a match adds it to the series.
    if (match_id) await query('INSERT INTO bracket_slot_matches (slot_id, match_id) VALUES ($1, $2) ON CONFLICT (match_id) DO UPDATE SET slot_id = EXCLUDED.slot_id', [req.params.id, match_id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
