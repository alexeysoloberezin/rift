import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { query as defaultQuery, withTransaction as defaultTransaction } from '../config/db.js';
import { requireAdmin as defaultRequireAdmin } from '../middleware/auth.js';
import { processDemo as defaultProcessDemo } from '../services/matchProcessing.service.js';

export function createDemosRouter(deps = {}) {
const query = deps.query || defaultQuery;
const withTransaction = deps.withTransaction || defaultTransaction;
const processDemo = deps.processDemo || defaultProcessDemo;
const requireAdmin = deps.requireAdmin || defaultRequireAdmin;
const router = Router();

router.get('/tournaments/:tournamentId/demos', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, original_name, status, uploaded_at FROM demos WHERE tournament_id = $1 AND match_id IS NULL ORDER BY uploaded_at DESC',
      [req.params.tournamentId]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/matches/:matchId/demo/attach', requireAdmin, async (req, res) => {
  try {
    const demoId = req.body.demo_id;
    if (typeof demoId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(demoId)) {
      return res.status(400).json({ success: false, error: 'Выберите загруженное демо' });
    }
    const demo = await withTransaction(async (tx) => {
      const { rows: matches } = await tx.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [req.params.matchId]);
      const match = matches[0];
      if (!match) throw Object.assign(new Error('Матч не найден'), { status: 404 });
      if (match.status === 'parsing_demo') throw Object.assign(new Error('Дождитесь обработки текущего демо'), { status: 409 });
      const { rows } = await tx.query('SELECT * FROM demos WHERE id = $1 FOR UPDATE', [demoId]);
      const uploaded = rows[0];
      if (!uploaded) throw Object.assign(new Error('Демо не найдено'), { status: 404 });
      if (uploaded.match_id || uploaded.tournament_id !== match.tournament_id || uploaded.status !== 'pending') {
        throw Object.assign(new Error('Демо уже привязано или недоступно для этого турнира'), { status: 409 });
      }
      await tx.query("UPDATE demos SET match_id = $1, status = 'parsing', error_message = NULL WHERE id = $2", [match.id, demoId]);
      await tx.query("UPDATE matches SET status = 'parsing_demo' WHERE id = $1", [match.id]);
      return { ...uploaded, match_id: match.id, status: 'parsing' };
    });
    res.status(202).json({ success: true, data: { id: demo.id, match_id: demo.match_id, status: demo.status } });
    Promise.resolve().then(() => processDemo(demo.id, demo.match_id, demo.storage_path)).catch(async (err) => {
      console.error('Ошибка обработки демо:', err.message);
      await query('UPDATE demos SET status = $1, error_message = $2 WHERE id = $3', ['error', err.message, demo.id]).catch(() => {});
      await query('UPDATE matches SET status = $1 WHERE id = $2', ['needs_demo', demo.match_id]).catch(() => {});
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';
fs.mkdirSync(path.join(UPLOADS_DIR, 'demos'), { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(UPLOADS_DIR, 'demos')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }); // до 2 ГБ на демку

// Этот роутер монтируется в index.js на "/api" — путь "/matches/:matchId/demo".

// POST /api/matches/:matchId/demo — загрузить .dem файл матча (админ)
router.post('/matches/:matchId/demo', requireAdmin, upload.single('demo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Файл не передан (поле "demo")' });

    const { matchId } = req.params;
    const { rows: matchRows } = await query('SELECT id FROM matches WHERE id = $1', [matchId]);
    if (matchRows.length === 0) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ success: false, error: 'Матч не найден' });
    }

    const { rows } = await query(
      `INSERT INTO demos (match_id, original_name, storage_path, status)
       VALUES ($1, $2, $3, 'pending') RETURNING *`,
      [matchId, req.file.originalname, req.file.path]
    );
    const demo = rows[0];

    await query('UPDATE matches SET status = $1 WHERE id = $2', ['parsing_demo', matchId]);
    await query('UPDATE demos SET status = $1 WHERE id = $2', ['parsing', demo.id]);

    // Парсинг демки может занимать минуты — отвечаем сразу, обработка идёт в фоне.
    // Клиент опрашивает GET /api/demos/:id для отслеживания статуса.
    res.status(202).json({ success: true, data: demo, message: 'Демка принята, парсинг запущен' });

    processDemo(demo.id, matchId, req.file.path).catch(async (err) => {
      console.error('❌ Ошибка обработки демки:', err.message);
      await query('UPDATE demos SET status = $1, error_message = $2 WHERE id = $3', ['error', err.message, demo.id]).catch(() => {});
      await query('UPDATE matches SET status = $1 WHERE id = $2', ['needs_demo', matchId]).catch(() => {});
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/demos/:id — статус обработки демки (для поллинга из фронта)
router.get('/demos/:id', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, match_id, original_name, status, error_message, uploaded_at, parsed_at FROM demos WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Демка не найдена' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

return router;
}

export default createDemosRouter();
