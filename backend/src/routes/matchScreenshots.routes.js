import { Router } from 'express';
import multer from 'multer';
import { query } from '../config/db.js';
import { requireAdmin } from '../middleware/auth.js';

export function imageType(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function createMatchScreenshotsRouter(deps = {}) {
  const db = deps.query || query;
  const auth = deps.requireAdmin || requireAdmin;
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } }).single('screenshot');
  router.post('/matches/:id/screenshot', auth, (req, res, next) => {
    upload(req, res, err => {
      if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, error: 'Выберите один скриншот PNG, JPEG или WebP до 10 МБ' });
      next();
    });
  }, async (req, res) => {
    try {
      const type = req.file && imageType(req.file.buffer);
      if (!type) return res.status(400).json({ success: false, error: 'Выберите скриншот PNG, JPEG или WebP' });
      const { rows } = await db(`INSERT INTO match_screenshots (match_id, content, content_type)
        SELECT id, $2, $3 FROM matches WHERE id = $1
        ON CONFLICT (match_id) DO UPDATE SET content = EXCLUDED.content, content_type = EXCLUDED.content_type, updated_at = now()
        RETURNING updated_at`, [req.params.id, req.file.buffer, type]);
      if (!rows.length) return res.status(404).json({ success: false, error: 'Матч не найден' });
      res.json({ success: true, data: rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: 'Не удалось сохранить скриншот' }); }
  });
  router.get('/matches/:id/screenshot', async (req, res) => {
    try {
      const { rows } = await db('SELECT content, content_type FROM match_screenshots WHERE match_id = $1', [req.params.id]);
      if (!rows.length) return res.sendStatus(404);
      res.set('Cache-Control', 'no-store').set('X-Content-Type-Options', 'nosniff').type(rows[0].content_type).send(rows[0].content);
    } catch { res.sendStatus(500); }
  });
  router.delete('/matches/:id/screenshot', auth, async (req, res) => {
    try {
      await db('DELETE FROM match_screenshots WHERE match_id = $1', [req.params.id]);
      res.json({ success: true });
    } catch { res.status(500).json({ success: false, error: 'Не удалось удалить скриншот' }); }
  });
  return router;
}
export default createMatchScreenshotsRouter();
