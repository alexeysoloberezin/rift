import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAdmin } from '../middleware/auth.js';

// Групповой этап турнира: ровно 2 группы (см. db/migrations/001_groups_and_bracket.sql).
// Этот роутер монтируется в index.js на "/api" (не "/api/tournaments" и не
// "/api/groups"), т.к. ему нужны и пути "/tournaments/:tournamentId/groups...",
// и "/groups/:id..." — тот же приём, что у matches.routes.js/demos.routes.js.

const router = Router();

const GROUP_NAMES = { 1: 'Группа A', 2: 'Группа B' };

// GET /api/tournaments/:tournamentId/groups — публично: обе группы турнира
// (если уже созданы админом) с составами команд и матчами, привязанными к
// каждой группе (matches.group_id) — это и есть "результаты встреч" группы.
router.get('/tournaments/:tournamentId/groups', async (req, res) => {
  try {
    const { rows: groups } = await query('SELECT * FROM groups WHERE tournament_id = $1 ORDER BY slot', [
      req.params.tournamentId,
    ]);
    if (groups.length === 0) return res.json({ success: true, data: [] });

    const groupIds = groups.map((g) => g.id);

    const { rows: teams } = await query(
      `SELECT gt.group_id, t.id, t.name, t.tag
       FROM group_teams gt
       JOIN teams t ON t.id = gt.team_id
       WHERE gt.group_id = ANY($1::uuid[])
       ORDER BY t.name`,
      [groupIds]
    );

    const { rows: matches } = await query(
      `SELECT m.*, ta.name AS team_a_name, tb.name AS team_b_name
       FROM matches m
       LEFT JOIN teams ta ON ta.id = m.team_a_id
       LEFT JOIN teams tb ON tb.id = m.team_b_id
       WHERE m.group_id = ANY($1::uuid[])
       ORDER BY m.created_at`,
      [groupIds]
    );

    const data = groups.map((g) => ({
      ...g,
      teams: teams.filter((t) => t.group_id === g.id),
      matches: matches.filter((m) => m.group_id === g.id),
    }));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===================== АДМИНСКИЕ ЭНДПОИНТЫ =====================

// POST /api/tournaments/:tournamentId/groups/init — идемпотентно создать
// ровно 2 группы турнира ("Группа A" / "Группа B"), если их ещё нет.
router.post('/tournaments/:tournamentId/groups/init', requireAdmin, async (req, res) => {
  try {
    for (const slot of [1, 2]) {
      await query(
        `INSERT INTO groups (tournament_id, name, slot) VALUES ($1, $2, $3)
         ON CONFLICT (tournament_id, slot) DO NOTHING`,
        [req.params.tournamentId, GROUP_NAMES[slot], slot]
      );
    }
    const { rows } = await query('SELECT * FROM groups WHERE tournament_id = $1 ORDER BY slot', [
      req.params.tournamentId,
    ]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/groups/:id — переименовать группу
router.put('/groups/:id', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Укажите название группы' });
    const { rows } = await query('UPDATE groups SET name = $1 WHERE id = $2 RETURNING *', [name, req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Группа не найдена' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/groups/:groupId/teams/:teamId — назначить команду в эту группу.
// Если команда уже была в другой группе (в т.ч. этого же турнира) —
// переносит её сюда: PRIMARY KEY на group_teams.team_id гарантирует, что
// у команды не может быть двух групп одновременно.
router.put('/groups/:groupId/teams/:teamId', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `INSERT INTO group_teams (team_id, group_id) VALUES ($1, $2)
       ON CONFLICT (team_id) DO UPDATE SET group_id = EXCLUDED.group_id
       RETURNING *`,
      [req.params.teamId, req.params.groupId]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/groups/:groupId/teams/:teamId — убрать команду из группы
router.delete('/groups/:groupId/teams/:teamId', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM group_teams WHERE group_id = $1 AND team_id = $2', [req.params.groupId, req.params.teamId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
