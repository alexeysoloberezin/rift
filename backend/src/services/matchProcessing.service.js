import path from 'node:path';
import { parseCsvFile } from './csvDemo.service.js';
import { withTransaction } from '../config/db.js';
import { parseDemoFile } from './demoParser.client.js';
import { computeMatchRating, computeEloSwing } from './rating.service.js';
import { matchTeamsByCaptain, normalizeCaptainName } from './teamCaptainMatching.js';
import { applyTournamentDemoAliases } from './demoAliases.service.js';

/**
 * Находит игрока в БД по steam_id64, а если не найден — по нику (без учёта
 * регистра). Если и это не помогло — создаёт нового игрока "с нуля"
 * (например, это заглянувший на замену игрок, которого не было в Excel).
 */
async function resolvePlayer(tx, { playerId, steamId, nickname, screenshot = false, tournamentId }) {
  if (playerId) {
    const { rows } = await tx.query('SELECT * FROM players WHERE id = $1', [playerId]);
    if (!rows[0]) throw new Error(`Игрок для ника «${nickname}» больше не существует`);
    return rows[0];
  }
  if (screenshot && !steamId) {
    const { rows } = await tx.query(`SELECT p.* FROM players p
      JOIN tournament_players tp ON tp.player_id = p.id
      WHERE tp.tournament_id = $1 AND LOWER(p.nickname) = LOWER($2)`, [tournamentId, nickname.trim()]);
    if (rows.length !== 1) throw new Error(`Не удалось однозначно найти «${nickname}» среди игроков турнира. Укажите его полный ник из RIFT или Steam ID в CSV.`);
    return rows[0];
  }
  if (steamId) {
    const { rows } = await tx.query('SELECT * FROM players WHERE steam_id64 = $1', [steamId]);
    if (rows[0]) return rows[0];
  }

  const { rows: byNick } = await tx.query('SELECT * FROM players WHERE LOWER(nickname) = LOWER($1)', [nickname]);
  if (byNick[0]) {
    // Если у найденного игрока ещё не проставлен steam_id — дозаполним
    if (steamId && !byNick[0].steam_id64) {
      await tx.query('UPDATE players SET steam_id64 = $1 WHERE id = $2', [steamId, byNick[0].id]);
      byNick[0].steam_id64 = steamId;
    }
    return byNick[0];
  }

  const { rows: created } = await tx.query(
    `INSERT INTO players (nickname, steam_id64) VALUES ($1, $2) RETURNING *`,
    [nickname, steamId || null]
  );
  return created[0];
}

/**
 * Реальный кейс: админ создал матч, не выбрав команды в форме (оба селекта
 * пустые — team_a_id/team_b_id = NULL), и сразу загрузил демку. Раньше это
 * приводило к тому, что ВСЕМ игрокам обеих команд ставился team_id = NULL,
 * и на странице матча обе колонки фильтровались одинаково (NULL === NULL) —
 * то есть в обеих показывались все 10 игроков сразу.
 *
 * Сначала ищем команды турнира по никам капитанов на каждой стороне демо.
 * Если совпадения нет и команда не задана, заводим "автосостав", названный
 * по карте матча (можно переименовать в админке команд позже), и сразу
 * заполняем её реальным составом из демки. Так демку можно грузить и без
 * предварительного создания команд — стороны просто возьмутся из самой игры.
 */
async function ensureMatchTeams(tx, match, parsed) {
  const autoCreated = { A: false, B: false };
  if (match.teams_manually_set && match.team_a_id && match.team_b_id) {
    return { match, autoCreated, captainTeams: { A: null, B: null } };
  }
  const { rows: teams } = await tx.query(
    'SELECT id, name, captain_name FROM teams WHERE tournament_id = $1 AND captain_name IS NOT NULL',
    [match.tournament_id]
  );
  const captainTeams = matchTeamsByCaptain(teams, parsed.players);

  let teamAId = captainTeams.A?.id || match.team_a_id;
  let teamBId = captainTeams.B?.id || match.team_b_id;
  if (teamAId && teamAId === teamBId) {
    throw new Error('Капитан в демо противоречит выбранным командам матча: одна команда оказалась на обеих сторонах');
  }

  if (!teamAId) {
    const { rows } = await tx.query(
      `INSERT INTO teams (tournament_id, name) VALUES ($1, $2) RETURNING id`,
      [match.tournament_id, parsed.team_a_name || `Автосостав A — ${parsed.map || 'без карты'}`]
    );
    teamAId = rows[0].id;
    autoCreated.A = true;
  }
  if (!teamBId) {
    const { rows } = await tx.query(
      `INSERT INTO teams (tournament_id, name) VALUES ($1, $2) RETURNING id`,
      [match.tournament_id, parsed.team_b_name || `Автосостав B — ${parsed.map || 'без карты'}`]
    );
    teamBId = rows[0].id;
    autoCreated.B = true;
  }

  await tx.query('UPDATE matches SET team_a_id = $1, team_b_id = $2 WHERE id = $3', [teamAId, teamBId, match.id]);
  return { match: { ...match, team_a_id: teamAId, team_b_id: teamBId }, autoCreated, captainTeams };
}

/**
 * Полный пайплайн обработки загруженной демки:
 *  1. Отправить файл в demo-parser сервис.
 *  2. Сматчить игроков демки с игроками БД (или создать новых).
 *  3. Посчитать match rating для каждого игрока.
 *  4. Посчитать ELO swing по итогу матча и применить его к players.rating.
 *  5. Сохранить всё в match_player_stats / player_rating_history и обновить матч.
 *
 * @param {string} demoId
 * @param {string} matchId
 * @param {string} filePath — путь к сохранённому .dem файлу на диске
 */
export async function processDemo(demoId, matchId, filePath, deps = {}) {
  const partial = path.extname(filePath).toLowerCase() === '.csv';
  const parsed = partial ? await (deps.parseCsvFile || parseCsvFile)(filePath) : await parseDemoFile(filePath);

  await (deps.withTransaction || withTransaction)(async (tx) => {
    const { rows: matchRows } = await tx.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [matchId]);
    let match = matchRows[0];
    if (!match) throw new Error('Матч не найден');

    if (partial) {
      const { rows: rated } = await tx.query('SELECT 1 FROM match_player_stats WHERE match_id = $1 AND elo_before IS NOT NULL LIMIT 1', [matchId]);
      if (rated.length) throw new Error('CSV не может заменить статистику матча с рассчитанным рейтингом. Загрузите полное демо или создайте отдельный матч.');
    }
    await applyTournamentDemoAliases(tx, match.tournament_id, parsed);
    const ensured = await ensureMatchTeams(tx, match, parsed);
    match = ensured.match;
    const { autoCreated, captainTeams } = ensured;

    // Матч мог уже обрабатываться раньше (переобработка после фикса парсера,
    // перезалив исправленной демки и т.д.). Если брать "рейтинг до матча" из
    // ТЕКУЩЕГО players.rating — он уже содержит swing от прошлой обработки
    // этого же матча, и каждая переобработка будет накручивать эло заново
    // поверх уже применённого изменения. Поэтому для игроков, у которых уже
    // есть строка match_player_stats по этому матчу, "рейтинг до матча"
    // берём из неё (то, каким он был на момент самой первой обработки), а не
    // из текущего players.rating.
    const { rows: existingStatsRows } = await tx.query(
      'SELECT player_id, elo_before FROM match_player_stats WHERE match_id = $1',
      [matchId]
    );
    const existingEloBefore = new Map(existingStatsRows.filter(r => r.elo_before != null).map((r) => [r.player_id, Number(r.elo_before)]));

    const teamAStats = [];
    const teamBStats = [];

    // Резолвим всех игроков и считаем им match rating
    const resolved = [];
    for (const pStat of parsed.players) {
      const player = await resolvePlayer(tx, { playerId: pStat.rift_player_id, steamId: pStat.steam_id, nickname: pStat.nickname,
        screenshot: parsed.csv_format === 'screenshot', tournamentId: match.tournament_id });
      if (resolved.some(item => item.player.id === player.id)) throw new Error('Несколько строк CSV соответствуют одному игроку');
      if (partial && !pStat.steam_id) pStat.steam_id = player.steam_id64 || null;
      const matchRating = partial ? null : computeMatchRating({
        kills: pStat.kills,
        deaths: pStat.deaths,
        assists: pStat.assists,
        damage: pStat.damage,
        roundsPlayed: pStat.rounds_played,
        kastRounds: pStat.kast_rounds,
      });
      const isReprocess = existingEloBefore.has(player.id);
      const eloBefore = isReprocess ? existingEloBefore.get(player.id) : Number(player.rating);
      resolved.push({ pStat, player, matchRating, isReprocess });

      const entry = {
        playerId: player.id,
        elo: eloBefore,
        matchRating,
      };
      if (pStat.side_majority === 'A') teamAStats.push(entry);
      else teamBStats.push(entry);
    }

    // Реальный кейс при частых тестовых перезаливах: пока в турнире ещё нет
    // Excel-импорта, resolvePlayer() резолвит игрока демки в НОВОГО игрока по
    // нику; после того как ник появился в клубном реестре (импорт/ручное
    // добавление), тот же steam_id при переобработке резолвится в ДРУГОГО,
    // уже существующего игрока. Старая строка match_player_stats (под старым
    // player_id) раньше просто оставалась висеть — с чужим/устаревшим ником
    // и, что хуже, её elo_change навсегда оставался применённым к рейтингу
    // старого player_id (никогда не откатывался). Явно откатываем и чистим
    // такие "осиротевшие" строки для игроков, которых в этой обработке
    // матча больше нет — тем же способом, что и полное удаление матча в
    // DELETE /api/matches/:id.
    const currentPlayerIds = new Set(resolved.map((r) => r.player.id));
    const staleRows = existingStatsRows.filter((r) => !currentPlayerIds.has(r.player_id));
    for (const s of staleRows) {
      if (s.elo_before != null) await tx.query(
        'UPDATE players SET rating = $1, matches_played = GREATEST(matches_played - 1, 0), updated_at = now() WHERE id = $2',
        [s.elo_before, s.player_id]
      );
      await tx.query('DELETE FROM player_rating_history WHERE player_id = $1 AND match_id = $2', [
        s.player_id,
        matchId,
      ]);
      await tx.query('DELETE FROM match_player_stats WHERE player_id = $1 AND match_id = $2', [
        s.player_id,
        matchId,
      ]);
    }

    const winner =
      parsed.team_a_score > parsed.team_b_score ? 'A' : parsed.team_a_score < parsed.team_b_score ? 'B' : 'draw';

    const eloChanges = partial ? new Map() : computeEloSwing({ teamA: teamAStats, teamB: teamBStats, winner });

    for (const { pStat, player, matchRating, isReprocess } of resolved) {
      const teamId = pStat.side_majority === 'A' ? match.team_a_id : match.team_b_id;

      // Добавляем участников демо в автосостав или команду, найденную по
      // капитану. Существующих участников не удаляем (возможны замены).
      const side = pStat.side_majority === 'A' ? 'A' : 'B';
      if (autoCreated[side] || captainTeams[side]) {
        const isCaptain = Boolean(captainTeams[side]) &&
          normalizeCaptainName(pStat.nickname) === normalizeCaptainName(captainTeams[side].captain_name);
        await tx.query(`INSERT INTO team_players (team_id, player_id, is_captain) VALUES ($1, $2, $3)
          ON CONFLICT (team_id, player_id) DO UPDATE SET is_captain = EXCLUDED.is_captain`, [
          teamId,
          player.id,
          isCaptain,
        ]);
      }

      const adr = partial ? pStat.adr ?? null : pStat.rounds_played ? Math.round((pStat.damage / pStat.rounds_played) * 100) / 100 : null;
      const kastPct = partial ? null : pStat.rounds_played ? Math.round((pStat.kast_rounds / pStat.rounds_played) * 10000) / 100 : 0;
      const change = eloChanges.get(player.id) || { eloBefore: null, eloAfter: null, eloChange: null };

      await tx.query(
        `INSERT INTO match_player_stats (
           match_id, player_id, team_id, rounds_played, kills, deaths, assists, headshots,
           damage, adr, kast_rounds, kast_pct, entry_kills, entry_deaths,
           clutches_won, clutches_played, multi_kills, match_rating, elo_before, elo_after, elo_change
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (match_id, player_id) DO UPDATE SET
           team_id = EXCLUDED.team_id,
           rounds_played = EXCLUDED.rounds_played, kills = EXCLUDED.kills, deaths = EXCLUDED.deaths,
           assists = EXCLUDED.assists, headshots = EXCLUDED.headshots, damage = EXCLUDED.damage,
           adr = EXCLUDED.adr, kast_rounds = EXCLUDED.kast_rounds, kast_pct = EXCLUDED.kast_pct,
           entry_kills = EXCLUDED.entry_kills, entry_deaths = EXCLUDED.entry_deaths,
           clutches_won = EXCLUDED.clutches_won, clutches_played = EXCLUDED.clutches_played,
           multi_kills = EXCLUDED.multi_kills, match_rating = EXCLUDED.match_rating,
           elo_before = EXCLUDED.elo_before, elo_after = EXCLUDED.elo_after, elo_change = EXCLUDED.elo_change`,
        [
          matchId, player.id, teamId, pStat.rounds_played, pStat.kills, pStat.deaths, pStat.assists,
          pStat.headshots || 0, pStat.damage, adr, pStat.kast_rounds, kastPct,
          pStat.entry_kills ?? (partial ? null : 0), pStat.entry_deaths ?? (partial ? null : 0), pStat.clutches_won ?? (partial ? null : 0), pStat.clutches_played ?? (partial ? null : 0),
          JSON.stringify(pStat.multi_kills || {}), matchRating, change.eloBefore, change.eloAfter, change.eloChange,
        ]
      );

      if (partial) continue;

      // matches_played увеличиваем только при самой первой обработке этого
      // матча для игрока — иначе переобработка задваивала бы счётчик матчей.
      await tx.query(
        `UPDATE players SET rating = $1, matches_played = matches_played + $2, updated_at = now() WHERE id = $3`,
        [change.eloAfter, isReprocess ? 0 : 1, player.id]
      );

      // DELETE + INSERT вместо голого INSERT: на (player_id, match_id) нет
      // уникального ограничения, поэтому обычный INSERT при переобработке
      // создавал бы дублирующую строку истории рейтинга вместо замены старой.
      await tx.query('DELETE FROM player_rating_history WHERE player_id = $1 AND match_id = $2', [
        player.id,
        matchId,
      ]);
      await tx.query(
        `INSERT INTO player_rating_history (player_id, match_id, elo_before, elo_after, elo_change)
         VALUES ($1, $2, $3, $4, $5)`,
        [player.id, matchId, change.eloBefore, change.eloAfter, change.eloChange]
      );
    }

    // Реальный кейс: в таблице составов показывались клубные (FACEIT)
    // ники, а в журнале раундов (топ фраггер/вход/клатч) — другие. Причина:
    // demo-parser — отдельный сервис без доступа к клубной БД, поэтому
    // rounds[].top_killer/entry_kill_by/entry_death_of/clutch.player — это
    // "сырые" имена из самой демки (текущий Steam-ник на момент записи),
    // а не зарегистрированный в клубе ник. Здесь мы уже знаем каждого
    // steam_id → клубного игрока (resolved), поэтому подменяем эти поля на
    // канонический ник перед сохранением, чтобы сайт везде показывал одно и
    // то же имя для одного и того же человека.
    const nicknameBySteamId = new Map(resolved.map(({ pStat, player }) => [pStat.steam_id, player.nickname]));
    const canonicalNickname = (steamId, fallback) =>
      steamId && nicknameBySteamId.has(steamId) ? nicknameBySteamId.get(steamId) : fallback;

    for (const round of parsed.rounds || []) {
      round.top_killer = canonicalNickname(round.top_killer_steam_id, round.top_killer);
      round.entry_kill_by = canonicalNickname(round.entry_kill_by_steam_id, round.entry_kill_by);
      round.entry_death_of = canonicalNickname(round.entry_death_of_steam_id, round.entry_death_of);
      if (round.clutch) {
        round.clutch.player = canonicalNickname(round.clutch.steam_id, round.clutch.player);
      }
      for (const kill of round.kills || []) {
        kill.attacker_nickname = canonicalNickname(kill.attacker_steam_id, kill.attacker_nickname);
        kill.victim_nickname = canonicalNickname(kill.victim_steam_id, kill.victim_nickname);
      }
    }
    for (const p of parsed.players || []) {
      p.nickname = canonicalNickname(p.steam_id, p.nickname);
    }

    await tx.query(
      `UPDATE matches SET map = COALESCE($1, map), score_a = CASE WHEN score_manually_set THEN score_a ELSE COALESCE($2, score_a) END, score_b = CASE WHEN score_manually_set THEN score_b ELSE COALESCE($3, score_b) END, status = $5 WHERE id = $4`,
      [parsed.map, parsed.team_a_score, parsed.team_b_score, matchId, partial ? 'played' : 'rated']
    );

    await tx.query(
      `UPDATE demos SET status = 'parsed', parsed_at = now(), raw_stats = $1 WHERE id = $2`,
      [JSON.stringify(parsed), demoId]
    );
  });
}
