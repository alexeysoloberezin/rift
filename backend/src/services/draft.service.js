import { query } from '../config/db.js';

/**
 * Классический snake draft: капитаны идут по порядку seed_order (0 = самый
 * слабый по elo). Раунд 0, 2, 4... — по возрастанию seed_order; раунд 1, 3,
 * 5... — в обратном порядке. Возвращает индекс В МАССИВЕ КАПИТАНОВ
 * (отсортированном по seed_order), чей сейчас ход, для заданного количества
 * уже сделанных пиков (0-based).
 *
 * Пример для 4 команд: пики 0,1,2,3 -> капитаны 0,1,2,3; пики 4,5,6,7 ->
 * капитаны 3,2,1,0 (капитан 3 пикает дважды подряд на стыке — это и есть
 * "змейка"); пики 8..11 -> снова 0,1,2,3, и т.д.
 */
export function turnTeamIndex(pickCount, teamsCount) {
  const round = Math.floor(pickCount / teamsCount);
  const posInRound = pickCount % teamsCount;
  return round % 2 === 0 ? posInRound : teamsCount - 1 - posInRound;
}

/**
 * Полное состояние драфта турнира: команды (с капитаном и уже выбранными
 * игроками), доступный для пика пул и чей сейчас ход. Используется и
 * публичной страницей турнира, и капитанской страницей по токену — единая
 * "правда" о состоянии драфта, чтобы два разных эндпоинта не могли разойтись
 * в подсчёте хода.
 *
 * Возвращает null, если для турнира ещё не запускали драфт.
 */
export async function getDraftBoard(tournamentId) {
  const { rows: draftRows } = await query('SELECT * FROM drafts WHERE tournament_id = $1', [tournamentId]);
  if (draftRows.length === 0) return null;
  const draft = draftRows[0];

  // ВАЖНО: pick_token сюда намеренно не попадает — этот запрос обслуживает
  // и публичную страницу турнира, и капитанскую (после того как та уже
  // прошла проверку токена отдельным запросом) — светить токены остальных
  // капитанов в общем ответе было бы дырой (кто угодно смог бы пикать за
  // чужую команду). Токены отдаются только один раз, самим POST /draft/start
  // (см. draft.routes.js), админу — для рассылки капитанам вручную.
  const { rows: draftTeams } = await query(
    `SELECT dt.id, dt.draft_id, dt.team_id, dt.captain_id, dt.seed_order,
            t.name AS team_name, t.tag AS team_tag,
            p.nickname AS captain_nickname, p.avatar_url AS captain_avatar_url
     FROM draft_teams dt
     JOIN teams t ON t.id = dt.team_id
     JOIN players p ON p.id = dt.captain_id
     WHERE dt.draft_id = $1
     ORDER BY dt.seed_order`,
    [draft.id]
  );

  const { rows: picks } = await query(
    `SELECT dp.pick_index, dp.team_id, dp.player_id, dp.picked_by, dp.picked_at,
            p.nickname, p.avatar_url
     FROM draft_picks dp
     JOIN players p ON p.id = dp.player_id
     WHERE dp.draft_id = $1
     ORDER BY dp.pick_index`,
    [draft.id]
  );

  const teamIds = draftTeams.map((t) => t.team_id);
  const { rows: available } = await query(
    `SELECT p.id, p.nickname, p.avatar_url, tp.seed_rating
     FROM tournament_players tp
     JOIN players p ON p.id = tp.player_id
     WHERE tp.tournament_id = $1
       AND p.id NOT IN (
         SELECT player_id FROM team_players WHERE team_id = ANY($2::uuid[])
       )
     ORDER BY tp.seed_rating DESC NULLS LAST, p.nickname`,
    [tournamentId, teamIds]
  );

  const pickCount = picks.length;
  const isFinished = draft.status === 'finished' || available.length === 0;
  const turnIndex = isFinished ? null : turnTeamIndex(pickCount, draft.teams_count);
  const currentTeam = turnIndex === null ? null : draftTeams[turnIndex];

  const teams = draftTeams.map((dt) => ({
    ...dt,
    is_on_the_clock: !isFinished && currentTeam?.team_id === dt.team_id,
    picks: picks.filter((p) => p.team_id === dt.team_id),
  }));

  return {
    id: draft.id,
    tournament_id: draft.tournament_id,
    teams_count: draft.teams_count,
    status: isFinished ? 'finished' : 'active',
    created_at: draft.created_at,
    round: Math.floor(pickCount / draft.teams_count) + (isFinished ? 0 : 1),
    pick_number: pickCount + 1,
    current_team_id: currentTeam?.team_id || null,
    teams,
    available_players: available,
  };
}
