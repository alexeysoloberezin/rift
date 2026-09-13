import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvStats } from '../src/services/csvDemo.service.js';

const header = 'matchid,mapnumber,steamid64,team,name,kills,deaths,damage,assists,head_shot_kills';
const csv = `${header}\r\n18,0,76561198841947059,Spectator,Viewer,0,0,0,0,0\r\n18,0,76561197993369444,team_one,"Игрок, ""один""",24,10,2164,4,13\r\n18,0,76561199508394114,team_two,Player,15,9,1853,7,8`;
test('CSV preserves Steam IDs, quoted UTF-8 names and excludes spectators', () => {
  const parsed = parseCsvStats('\uFEFF' + csv);
  assert.equal(parsed.players.length, 2);
  assert.equal(parsed.players[0].steam_id, '76561197993369444');
  assert.equal(parsed.players[0].nickname, 'Игрок, "один"');
  assert.deepEqual(parsed.players.map(p => p.side_majority), ['A', 'B']);
  assert.equal(parsed.players[0].damage, 2164);
  assert.equal(parsed.players[0].rounds_played, null);
  assert.equal(parsed.players[0].kast_rounds, null);
  assert.equal(parsed.team_a_score, null);
  assert.equal(parsed.map, null);
});
test('CSV rejects unsupported schema, mixed maps, duplicate IDs and invalid stats', () => {
  assert.throws(() => parseCsvStats('a,b\n1,2'), /колонки/);
  assert.throws(() => parseCsvStats(csv.replace('18,0,765611995', '18,1,765611995')), /одной карты/);
  assert.throws(() => parseCsvStats(csv.replace('76561199508394114', '76561197993369444')), /Steam ID/);
  assert.throws(() => parseCsvStats(csv.replace(',24,10,', ',-24,10,')), /kills/);
  assert.throws(() => parseCsvStats(csv.replace('team_two', 'team_one')), /две/);
});

test('screenshot CSV accepts full names without Steam IDs and preserves supplied ADR', () => {
  const csv = 'source,team,name,kills,deaths,assists,adr,head_shot_kills,source_rating\nscreenshot,A,PlayerOne,20,17,7,93.1,9,1.45\nscreenshot,B,PlayerTwo,24,15,7,113.6,14,1.37';
  const parsed = parseCsvStats(csv);
  assert.equal(parsed.csv_format, 'screenshot');
  assert.equal(parsed.players[0].steam_id, null);
  assert.equal(parsed.players[0].damage, null);
  assert.equal(parsed.players[0].adr, 93.1);
  assert.equal(parsed.players[0].source_rating, 1.45);
  assert.throws(() => parseCsvStats(csv.replace('PlayerOne', 'Player…')), /полный ник/);
  assert.throws(() => parseCsvStats(csv.replace('93.1', '-93.1')), /adr/);
});
