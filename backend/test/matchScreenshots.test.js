import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMatchScreenshotsRouter } from '../src/routes/matchScreenshots.routes.js';

test('screenshot upload, public read, replacement and deletion; auth and file validation', async t => {
  let saved = null;
  let exists = true;
  const app = express();
  app.use(createMatchScreenshotsRouter({
    requireAdmin: (req, res, next) => req.get('Authorization') === 'test' ? next() : res.sendStatus(401),
    query: async (sql, params) => {
      if (sql.startsWith('INSERT')) {
        if (!exists) return { rows: [] };
        saved = { content: params[1], content_type: params[2] };
        return { rows: [{ updated_at: new Date().toISOString() }] };
      }
      if (sql.startsWith('DELETE')) { saved = null; return { rows: [] }; }
      return { rows: saved ? [saved] : [] };
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/matches/test/screenshot`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=', 'base64');
  const upload = (data = png, auth = 'test') => {
    const body = new FormData(); body.append('screenshot', new Blob([data]), 'stats.png');
    return fetch(url, { method: 'POST', headers: { Authorization: auth }, body });
  };
  assert.equal((await upload(png, 'wrong')).status, 401);
  assert.equal((await upload('<svg/>')).status, 400);
  assert.equal((await upload()).status, 200);
  let response = await fetch(url);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal((await upload()).status, 200);
  assert.equal((await fetch(url, { method: 'DELETE', headers: { Authorization: 'test' } })).status, 200);
  assert.equal((await fetch(url)).status, 404);
  exists = false;
  assert.equal((await upload()).status, 404);
});
