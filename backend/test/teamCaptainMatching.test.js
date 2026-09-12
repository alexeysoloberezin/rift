import test from 'node:test';
import assert from 'node:assert/strict';
import { matchTeamsByCaptain } from '../src/services/teamCaptainMatching.js';

const teams = [
  { id: 'one', name: 'First', captain_name: ' Alice ' },
  { id: 'two', name: 'Second', captain_name: 'Bob' },
];
test('captains assign teams to actual demo sides regardless of order/case', () => {
  const result = matchTeamsByCaptain(teams, [
    { nickname: 'BOB', side_majority: 'A' },
    { nickname: 'alice', side_majority: 'B' },
    { nickname: 'other', side_majority: 'A' },
  ]);
  assert.equal(result.A.id, 'two');
  assert.equal(result.B.id, 'one');
});
test('unmatched captain leaves side for existing team or auto roster', () => {
  const result = matchTeamsByCaptain(teams, [{ nickname: 'Alice', side_majority: 'A' }]);
  assert.equal(result.A.id, 'one');
  assert.equal(result.B, null);
  assert.deepEqual(matchTeamsByCaptain([{ captain_name: null }], []), { A: null, B: null });
});
test('two captains on one side are rejected', () => {
  assert.throws(() => matchTeamsByCaptain(teams, [
    { nickname: 'Alice', side_majority: 'A' }, { nickname: 'Bob', side_majority: 'A' },
  ]), /нескольких команд/);
});
test('same captain nickname on opposite sides is rejected', () => {
  assert.throws(() => matchTeamsByCaptain(teams, [
    { nickname: 'Alice', side_majority: 'A' }, { nickname: 'ALICE', side_majority: 'B' },
  ]), /однозначно/);
});
