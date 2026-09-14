function winnerTeamId(match) {
  if (match.score_a == null || match.score_b == null || Number(match.score_a) === Number(match.score_b)) return null;
  return Number(match.score_a) > Number(match.score_b) ? match.team_a_id : match.team_b_id;
}

export function seriesWins(slot) {
  return (slot.matches || []).reduce((wins, match) => {
    const winner = winnerTeamId(match);
    if (winner && winner === slot.team_a_id) wins.a++;
    if (winner && winner === slot.team_b_id) wins.b++;
    return wins;
  }, { a: 0, b: 0 });
}

export function seriesWinner(slot) {
  if (!slot?.team_a_id || !slot?.team_b_id || !slot.matches?.length) return null;
  const wins = seriesWins(slot);
  const requiredWins = Math.floor(slot.matches.length / 2) + 1;
  if (wins.a >= requiredWins) return { teamId: slot.team_a_id, wins: wins.a, losses: wins.b, requiredWins };
  if (wins.b >= requiredWins) return { teamId: slot.team_b_id, wins: wins.b, losses: wins.a, requiredWins };
  return null;
}

// Scores are displayed in the bracket slot's stable team order even when a
// demo recorded those teams on opposite A/B sides.
export function alignedMatchScore(slot, match) {
  if (match.score_a == null || match.score_b == null) return null;
  if (match.team_a_id === slot.team_a_id && match.team_b_id === slot.team_b_id) {
    return { a: Number(match.score_a), b: Number(match.score_b) };
  }
  if (match.team_a_id === slot.team_b_id && match.team_b_id === slot.team_a_id) {
    return { a: Number(match.score_b), b: Number(match.score_a) };
  }
  return null;
}
