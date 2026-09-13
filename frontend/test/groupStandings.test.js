import test from 'node:test';
import assert from 'node:assert/strict';
import { standingsFor } from '../src/lib/groupStandings.js';
const teams = ['a', 'b', 'c'].map(id => ({ id, name: id }));
const match = (a, b, score_a, score_b) => ({ team_a_id: a, team_b_id: b, score_a, score_b });

test('13:11 gives winner +2 and loser -2; reversing score updates the ranking', () => {
  const group = { teams: teams.slice(0, 2), matches: [match('a', 'b', 13, 11)] };
  assert.deepEqual(standingsFor(group).map(r => [r.team.id, r.roundDiff, r.w, r.l]), [['a', 2, 1, 0], ['b', -2, 0, 1]]);
  group.matches[0].score_a = 9;
  assert.deepEqual(standingsFor(group).map(r => [r.team.id, r.roundDiff]), [['b', 2], ['a', -2]]);
});
test('difference sums all group matches and ranks ahead of number of wins', () => {
  const rows = standingsFor({ teams, matches: [match('a', 'b', 13, 0), match('a', 'c', 11, 13), match('b', 'c', 11, 13)] });
  assert.deepEqual(rows.map(r => [r.team.id, r.roundDiff, r.w]), [['a', 11, 1], ['c', 4, 2], ['b', -15, 0]]);
  assert.equal(rows.reduce((sum, r) => sum + r.roundDiff, 0), 0);
});
test('missing scores and invalid participants do not count, zero scores do', () => {
  const rows = standingsFor({ teams, matches: [match('a', 'b', null, 13), match('a', 'b', '', 13), match('a', 'other', 13, 0), match('a', 'a', 13, 0), match('a', 'b', 0, 13)] });
  assert.deepEqual(rows.map(r => [r.team.id, r.roundDiff]), [['b', 13], ['c', 0], ['a', -13]]);
});
test('equal difference uses wins then fewer losses', () => {
  const rows = standingsFor({ teams, matches: [match('a', 'b', 13, 11), match('a', 'b', 11, 13)] });
  assert.deepEqual(rows.map(r => r.team.id), ['a', 'b', 'c']);
});
