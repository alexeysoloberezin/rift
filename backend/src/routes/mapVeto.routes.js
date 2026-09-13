import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { query, withTransaction } from '../config/db.js';
import { requireAdmin } from '../middleware/auth.js';
import { DEFAULT_MAPS, vetoBoard, applyVeto } from '../services/mapVeto.service.js';

const router = Router();
const wrap = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (err) { res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'Не удалось выполнить действие' }); }
};
router.get('/map-veto', requireAdmin, wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM map_veto_sessions ORDER BY created_at DESC LIMIT 100');
  res.json({ success: true, data: rows.map(row => ({ ...vetoBoard(row), token_a: row.token_a, token_b: row.token_b })) });
}));
router.post('/map-veto', requireAdmin, wrap(async (req, res) => {
  const { title = 'Пики карт', team_a = 'Команда A', team_b = 'Команда B', best_of = 1, first_team = 'A' } = req.body;
  if (![title, team_a, team_b].every(value => typeof value === 'string' && value.trim() && value.trim().length <= 100)
      || ![1, 3].includes(best_of) || !['A', 'B'].includes(first_team)) {
    return res.status(400).json({ success: false, error: 'Укажите названия до 100 символов, формат и первую команду' });
  }
  const { rows } = await query(`INSERT INTO map_veto_sessions (title, team_a, team_b, best_of, first_team, maps, token_a, token_b)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [title.trim(), team_a.trim(), team_b.trim(), best_of, first_team, JSON.stringify(DEFAULT_MAPS), randomBytes(32).toString('hex'), randomBytes(32).toString('hex')]);
  res.status(201).json({ success: true, data: { ...vetoBoard(rows[0]), token_a: rows[0].token_a, token_b: rows[0].token_b } });
}));
router.get('/map-veto/team/:token', wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM map_veto_sessions WHERE token_a = $1 OR token_b = $1', [req.params.token]);
  if (!rows.length) return res.status(404).json({ success: false, error: 'Ссылка не найдена' });
  res.json({ success: true, data: vetoBoard(rows[0], rows[0].token_a === req.params.token ? 'A' : 'B') });
}));
router.post('/map-veto/team/:token', wrap(async (req, res) => {
  const board = await withTransaction(async tx => {
    const { rows } = await tx.query('SELECT * FROM map_veto_sessions WHERE token_a = $1 OR token_b = $1 FOR UPDATE', [req.params.token]);
    const session = rows[0];
    if (!session) throw Object.assign(new Error('Ссылка не найдена'), { status: 404 });
    const ownTeam = session.token_a === req.params.token ? 'A' : 'B';
    const actions = applyVeto(session, ownTeam, req.body.map, req.body.expected_turn);
    await tx.query('UPDATE map_veto_sessions SET actions = $1 WHERE id = $2', [JSON.stringify(actions), session.id]);
    return vetoBoard({ ...session, actions }, ownTeam);
  });
  res.json({ success: true, data: board });
}));
export default router;
