import test from 'node:test';
import assert from 'node:assert/strict';
import { alignedMatchScore, seriesWinner, seriesWins } from '../src/lib/bracketSeries.js';

test('series wins follow team IDs when A/B sides swap between maps', () => {
  const slot = {
    team_a_id: 'pm-a', team_b_id: 'mongol',
    matches: [
      { team_a_id: 'pm-a', team_b_id: 'mongol', score_a: 13, score_b: 2 },
      { team_a_id: 'mongol', team_b_id: 'pm-a', score_a: 8, score_b: 13 },
    ],
  };
  assert.deepEqual(seriesWins(slot), { a: 2, b: 0 });
  assert.deepEqual(seriesWinner(slot), { teamId: 'pm-a', wins: 2, losses: 0, requiredWins: 2 });
  assert.deepEqual(alignedMatchScore(slot, slot.matches[0]), { a: 13, b: 2 });
  assert.deepEqual(alignedMatchScore(slot, slot.matches[1]), { a: 13, b: 8 });
});

test('champion appears only after the final series is clinched', () => {
  const slot = { team_a_id: 'a', team_b_id: 'b', matches: [
    { team_a_id: 'a', team_b_id: 'b', score_a: 13, score_b: 8 },
    { team_a_id: 'b', team_b_id: 'a', score_a: null, score_b: null },
    { team_a_id: 'a', team_b_id: 'b', score_a: null, score_b: null },
  ] };
  assert.equal(seriesWinner(slot), null);
  slot.matches[1].score_a = 5;
  slot.matches[1].score_b = 13;
  assert.deepEqual(seriesWinner(slot), { teamId: 'a', wins: 2, losses: 0, requiredWins: 2 });
  assert.deepEqual(seriesWinner({ ...slot, matches: [slot.matches[0]] }), { teamId: 'a', wins: 1, losses: 0, requiredWins: 1 });
});

test('draws, missing scores and unrelated teams do not affect series', () => {
  const slot = { team_a_id: 'a', team_b_id: 'b', matches: [
    { team_a_id: 'a', team_b_id: 'b', score_a: 13, score_b: 13 },
    { team_a_id: 'a', team_b_id: 'b', score_a: null, score_b: null },
    { team_a_id: 'x', team_b_id: 'y', score_a: 13, score_b: 0 },
  ] };
  assert.deepEqual(seriesWins(slot), { a: 0, b: 0 });
  assert.equal(alignedMatchScore(slot, slot.matches[2]), null);
});
