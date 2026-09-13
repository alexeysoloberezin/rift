import test from 'node:test';
import assert from 'node:assert/strict';
import { processDemo } from '../src/services/matchProcessing.service.js';
import { parseCsvStats } from '../src/services/csvDemo.service.js';

const csv = 'matchid,mapnumber,steamid64,team,name,kills,deaths,damage,assists,head_shot_kills\n1,0,76561197993369444,one,Player1,10,8,1000,2,4\n1,0,76561199508394114,two,Player2,8,10,900,1,3';
test('CSV processing saves unknown metrics as NULL and does not change player Elo', async () => {
  const writes = [];
  await processDemo('demo', 'match', 'test.csv', {
    parseCsvFile: async () => parseCsvStats(csv),
    withTransaction: async fn => fn({ query: async (sql, params) => {
      if (sql.startsWith('SELECT * FROM matches')) return { rows: [{ id: 'match', teams_manually_set: true, team_a_id: 'a', team_b_id: 'b' }] };
      if (sql.startsWith('SELECT * FROM players')) return { rows: [{ id: params[0], nickname: 'Player', rating: 1000 }] };
      if (sql.startsWith('SELECT')) return { rows: [] };
      writes.push({ sql, params }); return { rows: [] };
    } }),
  });
  const stats = writes.filter(w => w.sql.includes('INSERT INTO match_player_stats'));
  assert.equal(stats.length, 2);
  for (const { params } of stats) {
    for (const index of [3, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20]) assert.equal(params[index], null);
  }
  assert.ok(!writes.some(w => /UPDATE players|INSERT INTO player_rating_history/.test(w.sql)));
  assert.equal(writes.find(w => w.sql.includes('UPDATE matches SET map')).params[4], 'played');
});
test('CSV cannot overwrite an already rated match', async () => {
  await assert.rejects(processDemo('demo', 'match', 'test.csv', {
    parseCsvFile: async () => parseCsvStats(csv),
    withTransaction: async fn => fn({ query: async sql => {
      if (sql.startsWith('SELECT * FROM matches')) return { rows: [{ id: 'match' }] };
      if (sql.startsWith('SELECT 1 FROM match_player_stats')) return { rows: [{}] };
      throw new Error('Unexpected write');
    } }),
  }), /рассчитанным рейтингом/);
});

test('screenshot names resolve only against tournament players; ADR is saved without Elo', async () => {
  const source = 'source,team,name,kills,deaths,assists,adr,head_shot_kills\nscreenshot,A,PlayerOne,20,17,7,93.1,9\nscreenshot,B,PlayerTwo,24,15,7,113.6,14';
  const writes = [];
  let missingPlayer = false;
  const deps = {
    parseCsvFile: async () => parseCsvStats(source),
    withTransaction: async fn => fn({ query: async (sql, params) => {
      if (sql.startsWith('SELECT * FROM matches')) return { rows: [{ id: 'match', tournament_id: 'tournament', teams_manually_set: true, team_a_id: 'a', team_b_id: 'b' }] };
      if (sql.includes('JOIN tournament_players')) {
        assert.equal(params[0], 'tournament');
        return { rows: missingPlayer ? [] : [{ id: params[1], nickname: params[1], rating: 1000 }] };
      }
      if (sql.startsWith('SELECT')) return { rows: [] };
      writes.push({ sql, params }); return { rows: [] };
    } }),
  };
  await processDemo('demo', 'match', 'test.csv', deps);
  const stats = writes.filter(w => w.sql.includes('INSERT INTO match_player_stats'));
  assert.deepEqual(stats.map(w => w.params[9]), [93.1, 113.6]);
  assert.ok(stats.every(w => w.params[8] === null && w.params[17] === null));
  assert.ok(!writes.some(w => /UPDATE players|INSERT INTO players|INSERT INTO player_rating_history/.test(w.sql)));
  missingPlayer = true;
  await assert.rejects(processDemo('demo', 'match', 'test.csv', deps), /полный ник/);
});
