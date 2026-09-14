import { parseCsvFile } from '../services/csvDemo.service.js';
import { detachMatchDemos } from '../services/detachDemos.service.js';
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { query as defaultQuery, withTransaction as defaultTransaction } from '../config/db.js';
import { requireAdmin as defaultRequireAdmin } from '../middleware/auth.js';
import { processDemo as defaultProcessDemo } from '../services/matchProcessing.service.js';
import { prepareMatchDemoReprocess } from '../services/reprocessDemo.service.js';

export function createDemosRouter(deps = {}) {
const query = deps.query || defaultQuery;
const withTransaction = deps.withTransaction || defaultTransaction;
const processDemo = deps.processDemo || defaultProcessDemo;
const requireAdmin = deps.requireAdmin || defaultRequireAdmin;
const downloadsDirectory = deps.downloadsDirectory || path.resolve(globalThis.process.env.UPLOADS_DIR || './uploads', 'demos');
const fileExists = deps.fileExists || fs.existsSync;
const router = Router();

router.post('/matches/:matchId/demo/reprocess', requireAdmin, async (req, res) => {
  try {
    const demo = await withTransaction(tx => prepareMatchDemoReprocess(tx, req.params.matchId, { fileExists }));
    res.status(202).json({
      success: true,
      data: { id: demo.id, match_id: demo.match_id, status: demo.status },
      message: 'Пересчёт статистики запущен',
    });
    Promise.resolve().then(() => processDemo(demo.id, demo.match_id, demo.storage_path)).catch(async (err) => {
      console.error('Ошибка повторной обработки демо:', err.message);
      await query('UPDATE demos SET status = $1, error_message = $2 WHERE id = $3', ['error', err.message, demo.id]).catch(() => {});
      await query(`UPDATE matches SET status = CASE
        WHEN score_manually_set AND score_a IS NOT NULL AND score_b IS NOT NULL THEN 'played'
        ELSE 'needs_demo' END WHERE id = $1`, [demo.match_id]).catch(() => {});
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

router.post('/matches/:matchId/demos/detach', requireAdmin, async (req, res) => {
  try {
    const demos = await withTransaction(tx => detachMatchDemos(tx, req.params.matchId));
    res.json({ success: true, data: demos, message: 'Демо отвязаны, статистика сброшена. Файлы сохранены.' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

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

router.get('/demos/:id/download', async (req, res) => {
  try {
    const { rows } = await query('SELECT original_name, storage_path FROM demos WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Демо не найдено' });
    const filePath = path.resolve(rows[0].storage_path);
    const relative = path.relative(downloadsDirectory, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return res.status(404).json({ success: false, error: 'Файл демо недоступен' });
    }
    const downloadName = path.basename(rows[0].original_name || filePath).replace(/[\r\n"]/g, '_');
    res.set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff');
    res.download(filePath, downloadName, (err) => {
      if (err && !res.headersSent) res.status(err.code === 'ENOENT' ? 404 : 500).json({ success: false, error: 'Файл демо не найден на сервере' });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Не удалось скачать демо' });
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
      return { ...uploaded, match_id: match.id, status: 'parsing', previous_status: match.status };
    });
    res.status(202).json({ success: true, data: { id: demo.id, match_id: demo.match_id, status: demo.status } });
    Promise.resolve().then(() => processDemo(demo.id, demo.match_id, demo.storage_path)).catch(async (err) => {
      console.error('Ошибка обработки демо:', err.message);
      await query('UPDATE demos SET status = $1, error_message = $2 WHERE id = $3', ['error', err.message, demo.id]).catch(() => {});
      await query('UPDATE matches SET status = $1 WHERE id = $2', [demo.previous_status || 'needs_demo', demo.match_id]).catch(() => {});
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
const upload = multer({ storage, fileFilter(req, file, cb) {
  if (!['.dem', '.csv'].includes(path.extname(file.originalname).toLowerCase())) return cb(Object.assign(new Error('Выберите .dem или .csv'), { status: 400 }));
  cb(null, true);
}, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }); // до 2 ГБ на демку

// Этот роутер монтируется в index.js на "/api" — путь "/matches/:matchId/demo".

// POST /api/matches/:matchId/demo — загрузить .dem файл матча (админ)
router.post('/matches/:matchId/demo', requireAdmin, upload.single('demo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Файл не передан (поле "demo")' });

    if (path.extname(req.file.originalname).toLowerCase() === '.csv') {
      try { await parseCsvFile(req.file.path); }
      catch (err) { throw Object.assign(err, { status: 400 }); }
    }
    const { matchId } = req.params;
    const { demo, previousStatus } = await withTransaction(async tx => {
      const { rows: matchRows } = await tx.query('SELECT id, tournament_id, status FROM matches WHERE id = $1 FOR UPDATE', [matchId]);
      if (!matchRows.length) throw Object.assign(new Error('Матч не найден'), { status: 404 });
      if (matchRows[0].status === 'parsing_demo') throw Object.assign(new Error('Дождитесь обработки текущего демо'), { status: 409 });
      const { rows } = await tx.query(
        "INSERT INTO demos (match_id, tournament_id, original_name, storage_path, status) VALUES ($1, $2, $3, $4, 'parsing') RETURNING *",
        [matchId, matchRows[0].tournament_id, req.file.originalname, req.file.path]);
      await tx.query('UPDATE matches SET status = $1 WHERE id = $2', ['parsing_demo', matchId]);
      return { demo: rows[0], previousStatus: matchRows[0].status };
    });

    // Парсинг демки может занимать минуты — отвечаем сразу, обработка идёт в фоне.
    // Клиент опрашивает GET /api/demos/:id для отслеживания статуса.
    res.status(202).json({ success: true, data: demo, message: 'Демка принята, парсинг запущен' });

    processDemo(demo.id, matchId, req.file.path).catch(async (err) => {
      console.error('❌ Ошибка обработки демки:', err.message);
      await query('UPDATE demos SET status = $1, error_message = $2 WHERE id = $3', ['error', err.message, demo.id]).catch(() => {});
      await query('UPDATE matches SET status = $1 WHERE id = $2', [previousStatus || 'needs_demo', matchId]).catch(() => {});
    });
  } catch (err) {
    console.error(err);
    if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
    res.status(err.status || 500).json({ success: false, error: err.message });
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
