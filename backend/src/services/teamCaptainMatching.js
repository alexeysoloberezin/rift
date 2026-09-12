export const normalizeCaptainName = (name) => String(name || '').trim().toLowerCase();

// Match each captain to a demo side, never to a team from another tournament.
export function matchTeamsByCaptain(teams, players) {
  const matched = { A: null, B: null };
  for (const team of teams) {
    const captain = normalizeCaptainName(team.captain_name);
    if (!captain) continue;
    const sides = new Set(players
      .filter((player) => normalizeCaptainName(player.nickname) === captain)
      .map((player) => player.side_majority));
    if (!sides.size) continue;
    if (sides.size !== 1 || !['A', 'B'].includes([...sides][0])) {
      throw new Error(`Не удалось однозначно определить сторону капитана «${team.captain_name}»`);
    }
    const side = [...sides][0];
    if (matched[side]) {
      throw new Error(`На стороне ${side} найдены капитаны нескольких команд: «${matched[side].name}» и «${team.name}»`);
    }
    matched[side] = team;
  }
  return matched;
}
