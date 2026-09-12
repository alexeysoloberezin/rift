import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServerDemosRouter } from '../src/routes/serverDemos.routes.js';

test('server demo upload HTTP contract', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rift-demo-test-'));
  let key = 'test-secret';
  let exists = true;
  let fail = false;
  const calls = [];
  const parsed = [];
  const app = express();
  app.use('/api', createServerDemosRouter({ directory, getKey: () => key,
    withTransaction: async (fn) => fn({ query: async (sql, params) => {
      calls.push({ sql, params });
      if (fail) throw new Error('Database unavailable');
      if (sql.startsWith('SELECT')) return { rows: exists ? [{ id: params[0] }] : [] };
      if (sql.includes('INSERT INTO matches')) return { rows: [{ id: 'match-id' }] };
      return { rows: [{ id: 'demo-id', match_id: 'match-id', status: 'parsing' }] };
    } }),
    processDemo: async (...args) => { parsed.push(args); },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const id = '12345678-1234-1234-1234-123456789abc';
  async function send({ token = 'test-secret', tournament = id, filename = 'match.dem', file = true } = {}) {
    const body = new FormData();
    // File first verifies that multipart field ordering does not matter.
    if (file) body.append('demo', new Blob(['demo-content']), filename);
    body.append('tournament_id', tournament);
    return fetch(`http://127.0.0.1:${server.address().port}/api/server/demos`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body,
    });
  }
  assert.equal((await send({ token: 'wrong' })).status, 401);
  key = '';
  assert.equal((await send()).status, 503);
  key = 'test-secret';
  assert.equal(calls.length, 0);
  assert.equal((await send({ tournament: 'invalid' })).status, 400);
  assert.equal((await send({ filename: 'match.txt' })).status, 400);
  assert.equal((await send({ file: false })).status, 400);
  exists = false;
  assert.equal((await send()).status, 404);
  exists = true;
  fail = true;
  assert.equal((await send()).status, 500);
  fail = false;
  assert.deepEqual(await readdir(directory), []);
  const response = await send();
  assert.equal(response.status, 202);
  const result = await response.json();
  assert.equal(result.data.tournament_id, id);
  assert.equal(result.data.match_id, 'match-id');
  assert.equal(result.data.status, 'parsing');
  assert.equal(parsed.length, 1);
  assert.equal((await readdir(directory)).length, 1);
  assert.ok(calls.some(({ sql, params }) => sql.includes('INSERT INTO matches') && params[0] === id));
});
