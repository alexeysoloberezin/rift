import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTournamentDemoAliases, normalizeDemoAlias } from '../src/services/demoAliases.service.js';

test('demo alias maps a raw unicode nickname to the registered tournament player', async () => {
  const tx = {
    query: async () => ({ rows: [{ player_id: 'pm-a-id', nickname: 'pm-a', demo_aliases: ['纪律', ' PM-A-demo '] }] }),
  };
  const parsed = { players: [{ nickname: '纪律', steam_id: '7656119' }, { nickname: 'teammate' }] };

  await applyTournamentDemoAliases(tx, 'tournament-id', parsed);

  assert.equal(parsed.players[0].nickname, 'pm-a');
  assert.equal(parsed.players[0].rift_player_id, 'pm-a-id');
  assert.equal(parsed.players[1].nickname, 'teammate');
  assert.equal(normalizeDemoAlias('  ＰＭ-A  '), 'pm-a');
});

test('duplicate aliases in one tournament are rejected instead of choosing a random player', async () => {
  const tx = {
    query: async () => ({ rows: [
      { player_id: 'one', nickname: 'one', demo_aliases: ['same'] },
      { player_id: 'two', nickname: 'two', demo_aliases: ['SAME'] },
    ] }),
  };

  await assert.rejects(
    () => applyTournamentDemoAliases(tx, 'tournament-id', { players: [] }),
    /сразу у нескольких игроков/
  );
});
