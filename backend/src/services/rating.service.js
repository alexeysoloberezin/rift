// ============================================================================
// RIFT Rating Engine
// ----------------------------------------------------------------------------
// Это НЕ официальная формула FACEIT или HLTV — их точные алгоритмы закрыты.
// Здесь реализована открытая, документированная методика "в духе" FACEIT/HLTV:
//
// 1) Match Performance Rating — по мотивам публично известной реконструкции
//    HLTV Rating 2.0 (используется многими open-source CS-статистикой):
//
//      Impact = 2.13*KPR + 0.42*APR - 0.41
//      Rating = 0.0073*KAST_pct + 0.3591*KPR - 0.5329*DPR
//               + 0.2372*Impact + 0.0032*ADR + 0.1587
//
//    где KPR/DPR/APR — килы/смерти/ассисты за раунд, ADR — средний урон за
//    раунд, KAST_pct — % раундов, где игрок либо убил, либо помог (assist),
//    либо выжил, либо был разменян (traded).
//
// 2) ELO Swing — общий рейтинг клуба (players.rating) обновляется как ELO:
//    ожидание побед считается по разнице среднего эло команд, а фактическое
//    изменение эло команды сначала делится поровну на всех игроков команды,
//    а затем к равной доле каждого ДОБАВЛЯЕТСЯ поправка, пропорциональная
//    тому, насколько его личный match rating отличается от среднего по
//    команде — то есть игрок, сыгравший сильнее среднего, получает поправку
//    в плюс (даже в проигранном матче теряет меньше остальных, а может и
//    выйти в плюс), а слабее среднего — поправку в минус (теряет больше
//    остальных, даже в выигранном матче).
// ============================================================================

const DEFAULT_K_FACTOR = Number(process.env.RATING_K_FACTOR || 30);

/**
 * @param {object} p
 * @param {number} p.kills
 * @param {number} p.deaths
 * @param {number} p.assists
 * @param {number} p.damage
 * @param {number} p.roundsPlayed
 * @param {number} p.kastRounds  — количество раундов, засчитанных в KAST
 * @returns {number} match rating (обычно в диапазоне ~0.5 - 1.8)
 */
export function computeMatchRating({ kills, deaths, assists, damage, roundsPlayed, kastRounds }) {
  if (!roundsPlayed || roundsPlayed <= 0) return 0;

  const kpr = kills / roundsPlayed;
  const dpr = deaths / roundsPlayed;
  const apr = assists / roundsPlayed;
  const adr = damage / roundsPlayed;
  const kastPct = (kastRounds / roundsPlayed) * 100;

  const impact = 2.13 * kpr + 0.42 * apr - 0.41;
  const rating =
    0.0073 * kastPct +
    0.3591 * kpr -
    0.5329 * dpr +
    0.2372 * impact +
    0.0032 * adr +
    0.1587;

  return Math.round(rating * 1000) / 1000;
}

/**
 * Ожидаемая вероятность победы команды A по формуле ELO.
 */
function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Считает изменение общего рейтинга (ELO swing) для каждого игрока матча.
 *
 * @param {object} params
 * @param {Array<{playerId:string, elo:number, matchRating:number}>} params.teamA
 * @param {Array<{playerId:string, elo:number, matchRating:number}>} params.teamB
 * @param {'A'|'B'|'draw'} params.winner
 * @param {number} [params.kFactor]
 * @returns {Map<string, {eloBefore:number, eloAfter:number, eloChange:number}>}
 */
export function computeEloSwing({ teamA, teamB, winner, kFactor = DEFAULT_K_FACTOR }) {
  const avg = (arr) => arr.reduce((s, p) => s + p.elo, 0) / arr.length;

  const avgA = avg(teamA);
  const avgB = avg(teamB);

  const expectedA = expectedScore(avgA, avgB);
  const expectedB = 1 - expectedA;

  const actualA = winner === 'A' ? 1 : winner === 'B' ? 0 : 0.5;
  const actualB = 1 - actualA;

  // Суммарное изменение эло команды (не на игрока, а на всю команду)
  const teamDeltaA = kFactor * (actualA - expectedA) * teamA.length;
  const teamDeltaB = kFactor * (actualB - expectedB) * teamB.length;

  const result = new Map();

  // Насколько сильно личный перфоманс сдвигает эло относительно "поровну на
  // всех" — коэффициент на единицу отклонения match rating от среднего по
  // команде. Привязан к kFactor, чтобы настраиваться тем же env-параметром
  // (RATING_K_FACTOR), которым уже управляют силой ELO-свинга в целом.
  const performanceFactor = kFactor * 0.5;

  for (const [team, teamDelta] of [
    [teamA, teamDeltaA],
    [teamB, teamDeltaB],
  ]) {
    const n = team.length;
    const avgRating = team.reduce((s, p) => s + p.matchRating, 0) / n;
    const equalShare = teamDelta / n;

    team.forEach((p) => {
      // ВАЖНО: поправка ДОБАВЛЯЕТСЯ к равной доле, а не умножает её как
      // раньше. Раньше teamDelta распределялась пропорционально весу
      // (matchRating / средний по команде) — это работало для победы
      // (teamDelta > 0: сильнее среднего = больше положительная доля), но
      // ломалось при поражении (teamDelta < 0: сильнее среднего = БОЛЬШАЯ
      // ПО МОДУЛЮ доля отрицательного числа, то есть игрок, сыгравший
      // ЛУЧШЕ всех в проигранной команде, терял эло СИЛЬНЕЕ всех — ровно
      // наоборот тому, что должно быть). Аддитивная поправка знак teamDelta
      // не трогает: игрок выше среднего по команде всегда получает поправку
      // в плюс (при поражении — теряет меньше остальных, при победе —
      // получает больше остальных), ниже среднего — всегда в минус.
      const deviation = p.matchRating - avgRating;
      const change = Math.round((equalShare + deviation * performanceFactor) * 100) / 100;

      const eloBefore = p.elo;
      const eloAfter = Math.round((eloBefore + change) * 100) / 100;

      result.set(p.playerId, {
        eloBefore,
        eloAfter,
        eloChange: Math.round((eloAfter - eloBefore) * 100) / 100,
      });
    });
  }

  return result;
}

// Примечание: сам KAST (kast_rounds) уже посчитан в demo-parser (Python,
// см. demo-parser/app/parser.py — там же и трейд-окно в 5 секунд). Сюда
// приходит готовое количество "кастовых" раундов на игрока, здесь только
// формула match rating и распределение ELO.
