// Match statistics describe the latest import, not an individual file. Reset
// the whole import and return every attached file to the tournament's inbox.
export async function detachMatchDemos(tx, matchId) {
  const { rows: matches } = await tx.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [matchId]);
  const match = matches[0];
  if (!match) throw Object.assign(new Error('Матч не найден'), { status: 404 });
  const { rows: demos } = await tx.query('SELECT id, status FROM demos WHERE match_id = $1 FOR UPDATE', [matchId]);
  if (match.status === 'parsing_demo' || demos.some(demo => demo.status === 'parsing')) {
    throw Object.assign(new Error('Дождитесь завершения обработки демо перед отвязкой'), { status: 409 });
  }

  const { rows: stats } = await tx.query(
    'SELECT player_id, elo_before, elo_after FROM match_player_stats WHERE match_id = $1 ORDER BY player_id', [matchId]);
  for (const stat of stats) {
    // CSV imports have no Elo contribution. Subtract only this match's delta;
    // restoring elo_before would also erase subsequent matches' contributions.
    if (stat.elo_before == null || stat.elo_after == null) continue;
    const delta = Number(stat.elo_after) - Number(stat.elo_before);
    await tx.query(`UPDATE players SET rating = rating - $1,
      matches_played = GREATEST(matches_played - 1, 0), updated_at = now() WHERE id = $2`, [delta, stat.player_id]);
    // Keep later recorded balances consistent without replaying their results.
    await tx.query(`UPDATE match_player_stats s SET elo_before = s.elo_before - $1, elo_after = s.elo_after - $1
      FROM player_rating_history later, player_rating_history removed
      WHERE removed.player_id = $2 AND removed.match_id = $3
        AND later.player_id = removed.player_id AND later.created_at > removed.created_at
        AND s.player_id = later.player_id AND s.match_id = later.match_id`, [delta, stat.player_id, matchId]);
    await tx.query(`UPDATE player_rating_history later SET elo_before = later.elo_before - $1, elo_after = later.elo_after - $1
      FROM player_rating_history removed WHERE removed.player_id = $2 AND removed.match_id = $3
        AND later.player_id = removed.player_id AND later.created_at > removed.created_at`, [delta, stat.player_id, matchId]);
  }
  await tx.query('DELETE FROM player_rating_history WHERE match_id = $1', [matchId]);
  await tx.query('DELETE FROM match_player_stats WHERE match_id = $1', [matchId]);
  const { rows: detached } = await tx.query(`UPDATE demos SET match_id = NULL, tournament_id = $2,
    status = 'pending', error_message = NULL, parsed_at = NULL, raw_stats = NULL
    WHERE match_id = $1 RETURNING id, original_name`, [matchId, match.tournament_id]);
  await tx.query(`UPDATE matches SET
    score_a = CASE WHEN score_manually_set THEN score_a ELSE NULL END,
    score_b = CASE WHEN score_manually_set THEN score_b ELSE NULL END,
    status = CASE WHEN score_manually_set AND score_a IS NOT NULL AND score_b IS NOT NULL THEN 'played' ELSE 'needs_demo' END
    WHERE id = $1`, [matchId]);
  return detached;
}
