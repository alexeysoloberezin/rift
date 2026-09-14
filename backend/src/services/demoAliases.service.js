export function normalizeDemoAlias(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

/**
 * Подменяет сырые ники из dem/csv на основной ник зарегистрированного игрока
 * до определения команд и сохранения статистики. player_id сохраняем рядом,
 * чтобы старый автоматически созданный профиль с тем же Steam ID не оказался
 * приоритетнее явного выбора организатора.
 */
export async function applyTournamentDemoAliases(tx, tournamentId, parsed) {
  const { rows } = await tx.query(
    `SELECT tp.player_id, tp.demo_aliases, p.nickname
     FROM tournament_players tp
     JOIN players p ON p.id = tp.player_id
     WHERE tp.tournament_id = $1 AND cardinality(tp.demo_aliases) > 0`,
    [tournamentId]
  );

  const byAlias = new Map();
  for (const row of rows) {
    for (const alias of row.demo_aliases || []) {
      const key = normalizeDemoAlias(alias);
      if (!key) continue;
      if (byAlias.has(key) && byAlias.get(key).player_id !== row.player_id) {
        throw new Error(`Ник из демо «${alias}» указан сразу у нескольких игроков турнира`);
      }
      byAlias.set(key, row);
    }
  }

  for (const player of parsed.players || []) {
    const registered = byAlias.get(normalizeDemoAlias(player.nickname));
    if (!registered) continue;
    player.rift_player_id = registered.player_id;
    player.nickname = registered.nickname;
  }
  return parsed;
}
