export const DEFAULT_MAPS = ['de_mirage', 'de_inferno', 'de_nuke', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_cache'];

// Two opening bans, alternating picks, then bans until the decider remains.
export function vetoBoard(session, ownTeam = null) {
  const actions = session.actions;
  const available = session.maps.filter(map => !actions.some(action => action.map === map));
  const finished = available.length === 1;
  const plan = session.best_of === 1
    ? Array(session.maps.length - 1).fill('ban')
    : [...Array(2).fill('ban'), ...Array(session.best_of - 1).fill('pick'), ...Array(session.maps.length - session.best_of - 2).fill('ban')];
  const nextTeam = actions.length % 2 === 0 ? session.first_team : session.first_team === 'A' ? 'B' : 'A';
  return {
    id: session.id, title: session.title, team_a: session.team_a, team_b: session.team_b,
    best_of: session.best_of, maps: session.maps, actions, available, own_team: ownTeam,
    finished, next_team: finished ? null : nextTeam, next_action: finished ? null : plan[actions.length],
    plan, first_team: session.first_team,
    result: [...actions.filter(action => action.type === 'pick').map(action => action.map), ...(finished ? available : [])],
  };
}

export function applyVeto(session, ownTeam, map, expectedTurn) {
  const board = vetoBoard(session, ownTeam);
  const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };
  if (board.finished) fail('Пики завершены');
  if (expectedTurn !== session.actions.length) fail('Состояние изменилось. Обновите страницу');
  if (board.next_team !== ownTeam) fail('Сейчас ход другой команды');
  if (!board.available.includes(map)) fail('Карта недоступна');
  return [...session.actions, { team: ownTeam, type: board.next_action, map }];
}
