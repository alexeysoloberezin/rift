import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDemosRouter } from '../src/routes/demos.routes.js';

test('attach uploaded demo only to an available match in its tournament', async (t) => {
  const id = '12345678-1234-1234-1234-123456789abc';
  let match = { id: 'match', tournament_id: 'tournament', status: 'needs_demo' };
  let demo = { id, tournament_id: 'tournament', match_id: null, status: 'pending', storage_path: 'file.dem' };
  const updates = [];
  const parsed = [];
  const app = express();
  app.use(express.json());
  app.use(createDemosRouter({
    requireAdmin: (req, res, next) => next(),
    withTransaction: async (fn) => fn({ query: async (sql, params) => {
      if (sql.startsWith('SELECT * FROM matches')) return { rows: match ? [match] : [] };
      if (sql.startsWith('SELECT * FROM demos')) return { rows: demo ? [demo] : [] };
      updates.push({ sql, params });
      return { rows: [] };
    } }),
    processDemo: async (...args) => parsed.push(args),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const send = (demo_id = id) => fetch(`http://127.0.0.1:${server.address().port}/matches/match/demo/attach`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ demo_id }),
  });
  assert.equal((await send('invalid')).status, 400);
  demo.tournament_id = 'other';
  assert.equal((await send()).status, 409);
  demo.tournament_id = 'tournament';
  demo.match_id = 'already-assigned';
  assert.equal((await send()).status, 409);
  demo.match_id = null;
  match.status = 'parsing_demo';
  assert.equal((await send()).status, 409);
  match.status = 'needs_demo';
  assert.equal(updates.length, 0);
  assert.equal(parsed.length, 0);
  const response = await send();
  assert.equal(response.status, 202);
  assert.equal((await response.json()).data.match_id, 'match');
  assert.equal(updates.length, 2);
  assert.deepEqual(parsed, [[id, 'match', 'file.dem']]);
});
