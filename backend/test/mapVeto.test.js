import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAPS, vetoBoard, applyVeto } from '../src/services/mapVeto.service.js';
const makeSession = (best_of = 1, first_team = 'A') => ({ id: 'session', title: 'Test', team_a: 'One', team_b: 'Two', token_a: 'secret-a', token_b: 'secret-b', maps: DEFAULT_MAPS, actions: [], best_of, first_team });
for (const bestOf of [1, 3]) {
  for (const firstTeam of ['A', 'B']) {
    test(`BO${bestOf}, first ${firstTeam}: alternating actions produce exact series`, () => {
      const session = makeSession(bestOf, firstTeam);
      for (let i = 0; i < 7; i++) {
        const board = vetoBoard(session);
        assert.equal(board.next_team, i % 2 === 0 ? firstTeam : firstTeam === 'A' ? 'B' : 'A');
        session.actions = applyVeto(session, board.next_team, board.available[0], i);
      }
      const final = vetoBoard(session);
      assert.equal(final.finished, true);
      assert.equal(final.result.length, bestOf);
      assert.equal(new Set(final.result).size, bestOf);
      assert.equal(final.next_team, null);
      assert.deepEqual(session.actions.map(a => a.type), bestOf === 1 ? Array(7).fill('ban') : ['ban', 'ban', 'pick', 'pick', 'ban', 'ban', 'ban']);
      assert.throws(() => applyVeto(session, 'B', final.available[0], 7), /завершены/);
    });
  }
}
test('reject out-of-turn, stale, invalid and already used maps', () => {
  const session = makeSession();
  assert.throws(() => applyVeto(session, 'B', DEFAULT_MAPS[0], 0), /другой команды/);
  assert.throws(() => applyVeto(session, 'A', 'de_overpass', 0), /недоступна/);
  session.actions = applyVeto(session, 'A', DEFAULT_MAPS[0], 0);
  assert.throws(() => applyVeto(session, 'B', DEFAULT_MAPS[1], 0), /изменилось/);
  assert.throws(() => applyVeto(session, 'B', DEFAULT_MAPS[0], 1), /недоступна/);
});
test('team board never exposes either secret link', () => {
  const board = vetoBoard(makeSession(), 'A');
  assert.equal(board.own_team, 'A');
  assert.equal(JSON.stringify(board).includes('secret'), false);
  assert.equal(DEFAULT_MAPS.length, 8);
  assert.ok(DEFAULT_MAPS.includes('de_cache') && DEFAULT_MAPS.includes('de_vertigo'));
  assert.ok(!DEFAULT_MAPS.includes('de_overpass'));
});
