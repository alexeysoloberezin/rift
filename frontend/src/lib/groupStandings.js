export function standingsFor(group) {
  const stats = new Map(group.teams.map(team => [team.id, { team, w: 0, l: 0, roundDiff: 0 }]));
  for (const match of group.matches) {
    if (match.score_a == null || match.score_b == null || match.score_a === '' || match.score_b === '') continue;
    const a = stats.get(match.team_a_id);
    const b = stats.get(match.team_b_id);
    const scoreA = Number(match.score_a);
    const scoreB = Number(match.score_b);
    if (!a || !b || a === b || !Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) continue;
    const difference = scoreA - scoreB;
    a.roundDiff += difference;
    b.roundDiff -= difference;
    if (difference > 0) { a.w++; b.l++; }
    if (difference < 0) { b.w++; a.l++; }
  }
  return [...stats.values()].sort((a, b) => b.roundDiff - a.roundDiff || b.w - a.w || a.l - b.l || a.team.name.localeCompare(b.team.name, 'ru'));
}
