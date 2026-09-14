import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMatchDemoReprocess } from '../src/services/reprocessDemo.service.js';

function database({ hasDemo = true, demoStatus = 'parsed', fileExists = true } = {}) {
  const state = {
    rating: 1100,
    count: 3,
    match: { id: 'match', tournament_id: 'tournament', status: 'rated' },
    demos: hasDemo ? [{ id: 'demo', match_id: 'match', tournament_id: 'tournament', status: demoStatus,
      storage_path: '/uploads/kept.dem', uploaded_at: '2026-01-01', parsed_at: '2026-01-02' }] : [],
    stats: [{ player_id: 'player', elo_before: 1000, elo_after: 1030 }],
  };
  const tx = { query: async (sql, params) => {
    if (sql.startsWith('SELECT d.*')) return { rows: state.demos.filter(d => d.match_id) };
    if (sql.startsWith('SELECT * FROM matches')) return { rows: [state.match] };
    if (sql.startsWith('SELECT id, status FROM demos')) return { rows: state.demos.filter(d => d.match_id) };
    if (sql.startsWith('SELECT player_id')) return { rows: state.stats };
    if (sql.startsWith('UPDATE players SET')) { state.rating -= params[0]; state.count--; }
    if (sql.startsWith('DELETE FROM match_player_stats')) state.stats = [];
    if (sql.startsWith('UPDATE demos SET match_id = NULL')) {
      const detached = state.demos.filter(d => d.match_id);
      detached.forEach(d => Object.assign(d, { match_id: null, status: 'pending' }));
      return { rows: detached };
    }
    if (sql.includes("status = 'parsing'")) Object.assign(state.demos.find(d => d.id === params[1]), { match_id: params[0], status: 'parsing' });
    if (sql.includes("status = 'parsing_demo'")) state.match.status = 'parsing_demo';
    return { rows: [] };
  } };
  return { state, tx, fileExists: () => fileExists };
}

test('reprocess keeps the demo, rolls back old stats and queues the same file', async () => {
  const { state, tx, fileExists } = database();
  const demo = await prepareMatchDemoReprocess(tx, 'match', { fileExists });
  assert.equal(demo.id, 'demo');
  assert.equal(demo.storage_path, '/uploads/kept.dem');
  assert.equal(state.rating, 1070);
  assert.equal(state.count, 2);
  assert.deepEqual(state.stats, []);
  assert.equal(state.demos[0].match_id, 'match');
  assert.equal(state.demos[0].status, 'parsing');
  assert.equal(state.match.status, 'parsing_demo');
});

test('reprocess rejects a missing, busy or deleted file before resetting stats', async () => {
  for (const options of [{ hasDemo: false }, { demoStatus: 'parsing' }, { fileExists: false }]) {
    const { state, tx, fileExists } = database(options);
    await assert.rejects(() => prepareMatchDemoReprocess(tx, 'match', { fileExists }));
    assert.equal(state.rating, 1100);
    assert.equal(state.stats.length, 1);
  }
});
