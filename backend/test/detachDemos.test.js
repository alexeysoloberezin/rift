import test from 'node:test';
import assert from 'node:assert/strict';
import { detachMatchDemos } from '../src/services/detachDemos.service.js';

function database({ status = 'rated', demoStatus = 'parsed', missing = false, csv = false } = {}) {
  const state = {
    rating: 1100, count: 3, writes: [],
    demos: [{ id: 'demo', status: demoStatus, match_id: 'match', storage_path: '/uploads/kept.dem', raw_stats: {} }],
    stats: [{ player_id: 'player', elo_before: csv ? null : 1000, elo_after: csv ? null : 1030 }],
  };
  const tx = { query: async (sql, params) => {
    if (sql.startsWith('SELECT * FROM matches')) return { rows: missing ? [] : [{ id: 'match', tournament_id: 'tournament', status }] };
    if (sql.startsWith('SELECT id, status FROM demos')) return { rows: state.demos.filter(d => d.match_id) };
    if (sql.startsWith('SELECT player_id')) return { rows: state.stats };
    state.writes.push({ sql, params });
    if (sql.startsWith('UPDATE players SET')) { state.rating -= params[0]; state.count--; }
    if (sql.startsWith('DELETE FROM match_player_stats')) state.stats = [];
    if (sql.startsWith('UPDATE demos SET')) {
      const detached = state.demos.filter(d => d.match_id);
      for (const demo of detached) Object.assign(demo, { match_id: null, tournament_id: params[1], status: 'pending', raw_stats: null });
      return { rows: detached };
    }
    return { rows: [] };
  } };
  return { state, tx };
}

test('detach resets statistics, preserves files and subtracts only this match Elo', async () => {
  const { tx, state } = database();
  const demos = await detachMatchDemos(tx, 'match');
  assert.equal(demos.length, 1);
  assert.equal(state.rating, 1070); // Keep the +70 from later matches.
  assert.equal(state.count, 2);
  assert.deepEqual(state.stats, []);
  assert.equal(state.demos[0].storage_path, '/uploads/kept.dem');
  assert.equal(state.demos[0].tournament_id, 'tournament');
  assert.equal(state.demos[0].match_id, null);
  assert.equal(state.demos[0].status, 'pending');
  assert.equal(state.demos[0].raw_stats, null);
  assert.ok(!state.writes.some(w => /DELETE FROM demos|DELETE FROM matches|match_screenshots/.test(w.sql)));
  assert.ok(state.writes.some(w => w.sql.includes('CASE WHEN score_manually_set THEN score_a ELSE NULL END')));
  await detachMatchDemos(tx, 'match');
  assert.equal(state.rating, 1070);
  assert.equal(state.count, 2);
});

test('CSV detach does not change Elo or rated match count', async () => {
  const { tx, state } = database({ csv: true, status: 'played' });
  await detachMatchDemos(tx, 'match');
  assert.equal(state.rating, 1100);
  assert.equal(state.count, 3);
});

test('processing and missing matches reject detach before any writes', async () => {
  for (const options of [{ status: 'parsing_demo' }, { demoStatus: 'parsing' }, { missing: true }]) {
    const { tx, state } = database(options);
    await assert.rejects(detachMatchDemos(tx, 'match'), err => err.status === (options.missing ? 404 : 409));
    assert.deepEqual(state.writes, []);
  }
});
