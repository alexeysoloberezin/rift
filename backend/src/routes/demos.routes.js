import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { query } from '../config/db.js';
import { requireAdmin } from '../middleware/auth.js';
import { processDemo } from '../services/matchProcessing.service.js';

const router = Router();

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

export default router;
