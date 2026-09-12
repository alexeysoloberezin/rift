// Average known tournament FACEIT seed Elo in the current roster, including the captain.
// alias is a static SQL alias supplied by route code, never request input.
export function teamEloSql(alias) {
  return `(SELECT AVG(tp.seed_rating) FROM team_players roster
    LEFT JOIN tournament_players tp ON tp.player_id = roster.player_id
      AND tp.tournament_id = ${alias}.tournament_id
    WHERE roster.team_id = ${alias}.id)`;
}
