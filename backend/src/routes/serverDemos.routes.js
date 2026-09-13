import { parseCsvFile } from '../services/csvDemo.service.js';
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { withTransaction } from '../config/db.js';


// Dependencies can be replaced in HTTP tests without a live database/parser.
export function createServerDemosRouter(deps = {}) {

  const transaction = deps.withTransaction || withTransaction;

  const getKey = deps.getKey || (() => globalThis.process.env.CS2_DEMO_API_KEY);
  const directory = deps.directory || path.join(globalThis.process.env.UPLOADS_DIR || './uploads', 'demos');
  const router = Router();
  const upload = multer({
    storage: multer.diskStorage({
      destination(req, file, cb) {
        fs.mkdir(directory, { recursive: true }, (err) => cb(err, directory));
      },
      filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1, fields: 1, fieldSize: 128 },
    fileFilter(req, file, cb) {
      if (!['.dem', '.csv'].includes(path.extname(file.originalname).toLowerCase())) {
        return cb(Object.assign(new Error('Допускаются только файлы .dem или .csv'), { status: 400 }));
      }
      cb(null, true);
    },
  }).single('demo');

  router.post('/server/demos', (req, res, next) => {
    const key = getKey();
    if (!key) return res.status(503).json({ success: false, error: 'CS2_DEMO_API_KEY не настроен' });
    const supplied = Buffer.from(req.get('Authorization') || '');
    const expected = Buffer.from(`Bearer ${key}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return res.status(401).json({ success: false, error: 'Неверный API-ключ' });
    }
    next();
  }, (req, res, next) => {
    upload(req, res, (err) => {
      if (!err) return next();
      res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : err instanceof multer.MulterError ? 400 : err.status || 500)
        .json({ success: false, error: err.message });
    });
  }, async (req, res) => {
    try {
      const id = req.body?.tournament_id;
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw Object.assign(new Error('Укажите tournament_id в формате UUID'), { status: 400 });
      }
      if (!req.file || req.file.size === 0) {
        throw Object.assign(new Error('Передайте непустой файл .dem или .csv в поле demo'), { status: 400 });
      }
      if (path.extname(req.file.originalname).toLowerCase() === '.csv') {
        try { await parseCsvFile(req.file.path); }
        catch (err) { throw Object.assign(err, { status: 400 }); }
      }
      const demo = await transaction(async (tx) => {
        const { rows: tournaments } = await tx.query('SELECT id FROM tournaments WHERE id = $1 FOR KEY SHARE', [id]);
        if (!tournaments.length) throw Object.assign(new Error('Турнир не найден'), { status: 404 });
        const { rows } = await tx.query(
          "INSERT INTO demos (tournament_id, original_name, storage_path, status) VALUES ($1, $2, $3, 'pending') RETURNING id, match_id, original_name, status, uploaded_at",
          [id, req.file.originalname, req.file.path]);
        return rows[0];
      });
      res.status(202).json({ success: true, data: { ...demo, tournament_id: id }, message: 'Демо загружено. Выберите его в нужном матче для обработки.' });
    } catch (err) {
      if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
      if (!err.status) console.error('Ошибка загрузки серверной демки:', err);
      res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'Не удалось сохранить демку' });
    }
  });
  return router;
}

export default createServerDemosRouter();
