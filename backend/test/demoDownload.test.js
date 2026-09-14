import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDemosRouter } from '../src/routes/demos.routes.js';

test('demo download streams original file with attachment filename', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rift-download-'));
  const filePath = path.join(directory, 'stored.dem');
  const contents = Buffer.from('demo bytes');
  await writeFile(filePath, contents);
  let row = { storage_path: filePath, original_name: 'final map.dem' };
  const app = express();
  app.use(createDemosRouter({
    downloadsDirectory: directory,
    query: async sql => ({ rows: sql.startsWith('SELECT original_name') && row ? [row] : [] }),
    requireAdmin: (req, res, next) => next(),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/demos/id/download`;
  let response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /attachment; filename="final map.dem"/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), contents);
  row = { storage_path: path.join(directory, '..', 'secret.dem'), original_name: 'secret.dem' };
  assert.equal((await fetch(url)).status, 404);
  row = null;
  assert.equal((await fetch(url)).status, 404);
});
