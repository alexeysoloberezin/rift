import test from 'node:test';
import assert from 'node:assert/strict';
import { setMatchStage } from '../src/services/matchStage.service.js';

function fakeTx(matchId) {
  const calls = [];
  return { calls, query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT id, tournament_id FROM matches')) return { rows: [{ id: matchId, tournament_id: 'tournament' }] };
    if (sql.startsWith('SELECT id FROM bracket_slots')) return { rows: [{ id: 'semifinal-1' }] };
    if (sql.startsWith('SELECT * FROM matches')) return { rows: [{ id: matchId }] };
    return { rows: [] };
  } };
}

test('three matches can join the same semifinal without clearing one another', async () => {
  const links = [];
  for (const id of ['map-1', 'map-2', 'map-3']) {
    const tx = fakeTx(id);
    tx.query = async (sql, params) => {
      tx.calls.push({ sql, params });
      if (sql.startsWith('SELECT id, tournament_id FROM matches')) return { rows: [{ id, tournament_id: 'tournament' }] };
      if (sql.startsWith('SELECT id FROM bracket_slots')) return { rows: [{ id: 'semifinal-1' }] };
      if (sql.startsWith('INSERT INTO bracket_slot_matches')) { links.push(params); return { rows: [] }; }
      if (sql.startsWith('SELECT * FROM matches')) return { rows: [{ id }] };
      return { rows: [] };
    };
    await setMatchStage(tx, id, 'semifinal:0');
    assert.ok(!tx.calls.some(call => call.sql.includes('UPDATE bracket_slots SET match_id')));
    assert.deepEqual(tx.calls.find(call => call.sql.startsWith('DELETE FROM bracket_slot_matches')).params, [id]);
  }
  assert.deepEqual(links, [['semifinal-1', 'map-1'], ['semifinal-1', 'map-2'], ['semifinal-1', 'map-3']]);
});

test('moving one match removes only its link and validates the destination', async () => {
  const tx = fakeTx('map-2');
  await setMatchStage(tx, 'map-2', null);
  assert.deepEqual(tx.calls.find(call => call.sql.startsWith('DELETE FROM bracket_slot_matches')).params, ['map-2']);
  await assert.rejects(setMatchStage(fakeTx('map-2'), 'map-2', 'quarterfinal:0'), /Некорректный/);
});
