<script setup>
import TeamElo from '../components/TeamElo.vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import apiClient from '../api/client';
import StatusBadge from '../components/StatusBadge.vue';
import RatingDelta from '../components/RatingDelta.vue';
import MapBadge from '../components/MapBadge.vue';
import PlayerAvatar from '../components/PlayerAvatar.vue';
import FaceitLevelBadge from '../components/FaceitLevelBadge.vue';
import { faceitLevel } from '../lib/faceit';
import { seriesWinner } from '../lib/bracketSeries';

const route = useRoute();
const tournament = ref(null);
const leaderboard = ref([]);
const draft = ref(null);
const bracket = ref([]);
const loading = ref(true);
let pollTimer = null;
let disposed = false;
const loadError = ref('');

// Стандартный размер состава CS2 — 5. Пока команда не набрана драфтом
// целиком, пустые места показываем как явные слоты, а не просто обрываем
// список — так видно, скольких игроков ещё не хватает.
const ROSTER_SIZE = 5;
function rosterSlots(team) {
  const players = [...team.players].sort((a, b) =>
    (b.seed_rating == null ? -Infinity : Number(b.seed_rating)) -
    (a.seed_rating == null ? -Infinity : Number(a.seed_rating)) || a.nickname.localeCompare(b.nickname)
  );
  const slots = players.map((p) => ({ filled: true, player: p }));
  while (slots.length < ROSTER_SIZE) slots.push({ filled: false });
  return slots;
}

const draftCurrentTeamName = computed(
  () => draft.value?.teams.find((t) => t.team_id === draft.value.current_team_id)?.team_name
);

const champion = computed(() => {
  const finalSlot = bracket.value.find((slot) => slot.round === 'final' && slot.slot_index === 0);
  const result = seriesWinner(finalSlot);
  if (!result) return null;
  const team = tournament.value?.teams.find((item) => item.id === result.teamId);
  return team ? { ...result, team } : null;
});

const tournamentMvp = computed(() => {
  if (!champion.value) return null;
  const rated = leaderboard.value
    .filter((player) => player.avg_match_rating != null && Number(player.matches_played) > 0)
    .sort((a, b) => Number(b.avg_match_rating) - Number(a.avg_match_rating)
      || Number(b.matches_played) - Number(a.matches_played)
      || a.nickname.localeCompare(b.nickname));
  const player = rated[0];
  if (!player) return null;
  const team = tournament.value?.teams.find((item) => item.players.some((member) => member.player_id === player.id));
  return { ...player, team_name: team?.name || null };
});

const matchesWithDemos = computed(() => (tournament.value?.matches || []).filter((match) => match.demos?.length));
const demoDownloadUrl = (demo) => apiClient.defaults.baseURL.replace(/\/$/, '') + '/demos/' + demo.id + '/download';
const fileKind = (name) => String(name || '').toLowerCase().endsWith('.csv') ? 'CSV' : 'DEM';
const demoStatusLabel = (status) => ({ parsed: 'Готово', parsing: 'Обработка', pending: 'Ожидает', error: 'Ошибка' }[status] || status);

async function load() {
  // loading=true (а значит и весь v-if в шаблоне ниже) выставляем только на
  // самой первой загрузке. Раньше это делалось на каждый вызов load(), а
  // load() дёргается поллингом раз в 3 сек, пока активен драфт — весь
  // контейнер страницы размонтировался и монтировался заново, и браузер при
  // этом сбрасывал скролл в начало. При обычном фоновом рефетче контент уже
  // есть, второй раз его прятать не нужно.
  if (!tournament.value) loading.value = true;

  try {
    const [{ data: tData }, { data: lbData }, { data: dData }, { data: bracketData }] = await Promise.all([
      apiClient.get(`/tournaments/${route.params.id}`),
      apiClient.get(`/tournaments/${route.params.id}/leaderboard`),
      apiClient.get(`/tournaments/${route.params.id}/draft`),
      apiClient.get(`/tournaments/${route.params.id}/bracket`),
    ]);
    if (disposed) return;
    tournament.value = tData.data;
    leaderboard.value = lbData.data;
    draft.value = dData.data;
    bracket.value = bracketData.data;
    loadError.value = '';
  } catch (err) {
    if (!disposed) loadError.value = 'Не удалось обновить турнир. Повторяем загрузку…';
  } finally {
    if (!disposed) loading.value = false;
  }

  // Пока драфт активен — обновляем страницу сами, чтобы пики капитанов было
  // видно в реальном времени и здесь, а не только на отдельной /draft.
  clearTimeout(pollTimer);
  if (!disposed && (draft.value?.status === 'active' || loadError.value)) {
    pollTimer = setTimeout(load, 3000);
  }
}

onMounted(load);
onUnmounted(() => {
  disposed = true;
  clearTimeout(pollTimer);
});
</script>

<template>
  <div class="container" v-if="!loading && tournament">
    <div class="t-header">
      <div>
        <p class="text-muted t-format">{{ tournament.format || 'Формат не указан' }}</p>
        <h1>{{ tournament.name }}</h1>
      </div>
      <StatusBadge :status="tournament.status" />
    </div>
    <p v-if="tournament.description" class="t-desc">{{ tournament.description }}</p>

    <div class="t-nav">
      <RouterLink :to="`/tournaments/${tournament.id}/draft`" class="btn">Драфт</RouterLink>
      <RouterLink :to="`/tournaments/${tournament.id}/groups`" class="btn">Группы</RouterLink>
      <RouterLink :to="`/tournaments/${tournament.id}/bracket`" class="btn">Плей-офф</RouterLink>
    </div>

    <section v-if="champion" class="results-hero" aria-label="Итоги турнира">
      <div class="champion-panel">
        <div class="trophy" aria-hidden="true">♛</div>
        <div class="champion-copy">
          <p class="result-label">Победитель турнира</p>
          <h2>{{ champion.team.name }}</h2>
          <p class="text-muted">Финальная серия {{ champion.wins }}:{{ champion.losses }}</p>
        </div>
        <div class="champion-roster" v-if="champion.team.players.length">
          <span v-for="player in champion.team.players" :key="player.player_id">{{ player.nickname }}</span>
        </div>
      </div>
      <RouterLink v-if="tournamentMvp" :to="`/players/${tournamentMvp.id}`" class="mvp-panel">
        <div class="mvp-crown" aria-hidden="true">★</div>
        <div>
          <p class="result-label">MVP турнира</p>
          <h3>{{ tournamentMvp.nickname }}</h3>
          <p v-if="tournamentMvp.team_name" class="text-muted">{{ tournamentMvp.team_name }}</p>
        </div>
        <div class="mvp-rating mono">
          <strong>{{ Number(tournamentMvp.avg_match_rating).toFixed(2) }}</strong>
          <span>ср. рейтинг</span>
        </div>
      </RouterLink>
      <div v-else class="mvp-panel mvp-panel--empty">
        <div class="mvp-crown" aria-hidden="true">★</div>
        <div><p class="result-label">MVP турнира</p><p class="text-muted">Появится после расчёта статистики игроков</p></div>
      </div>
    </section>

    <RouterLink
      v-if="draft && draft.status === 'active'"
      :to="`/tournaments/${tournament.id}/draft`"
      class="card draft-banner"
    >
      <span class="live-dot"></span>
      <span class="draft-banner__text">
        Идёт драфт капитанов — сейчас выбирает
        <strong class="draft-banner__team">{{ draftCurrentTeamName }}</strong>
        <span class="text-muted"> · пик №{{ draft.pick_number }}, раунд {{ draft.round }}</span>
      </span>
      <span class="draft-banner__cta">Смотреть →</span>
    </RouterLink>
    <p v-else-if="draft && draft.status === 'finished'" class="text-muted draft-finished-note">
      Составы сформированы драфтом капитанов.
    </p>

    <section>
      <h2 class="block-title">Матчи</h2>
      <div class="card" v-if="tournament.matches.length">
        <RouterLink
          v-for="m in tournament.matches"
          :key="m.id"
          :to="`/matches/${m.id}`"
          class="scoreboard-row match-row"
        >
          <MapBadge :map="m.map" size="md" :show-label="false" />
          <div>
            <div class="match-row__teams">
              {{ m.team_a_name || 'TBD' }} <TeamElo v-if="m.team_a_name" :value="m.team_a_average_elo" /> <span class="text-muted">vs</span> {{ m.team_b_name || 'TBD' }} <TeamElo v-if="m.team_b_name" :value="m.team_b_average_elo" />
            </div>
            <div class="text-muted match-row__meta">{{ m.map || 'карта не выбрана' }} · {{ m.round_number || '—' }}</div>
          </div>
          <div class="match-row__right">
            <span v-if="m.score_a !== null" class="mono score">{{ m.score_a }}:{{ m.score_b }}</span>
            <StatusBadge :status="m.status" />
          </div>
        </RouterLink>
      </div>
      <p v-else class="text-muted">Матчи ещё не назначены.</p>

      <section v-if="matchesWithDemos.length" class="demos-section">
        <div class="demos-heading">
          <div><p class="text-muted t-format">Материалы матчей</p><h2>Демо и статистика</h2></div>
          <span class="demo-count mono">{{ matchesWithDemos.reduce((sum, match) => sum + match.demos.length, 0) }} файлов</span>
        </div>
        <div class="demos-list">
          <article v-for="match in matchesWithDemos" :key="match.id" class="card demo-match">
            <RouterLink :to="`/matches/${match.id}`" class="demo-match__title">
              <MapBadge :map="match.map" size="sm" :show-label="false" />
              <span><strong>{{ match.team_a_name || 'Команда A' }} — {{ match.team_b_name || 'Команда B' }}</strong><small>{{ match.map || 'Карта не указана' }}<template v-if="match.score_a != null"> · {{ match.score_a }}:{{ match.score_b }}</template></small></span>
              <span aria-hidden="true">→</span>
            </RouterLink>
            <div class="demo-files">
              <a v-for="demo in match.demos" :key="demo.id" :href="demoDownloadUrl(demo)" class="demo-file" download>
                <span class="demo-file__type mono">{{ fileKind(demo.original_name) }}</span>
                <span class="demo-file__name">{{ demo.original_name || 'Файл матча' }}</span>
                <span class="demo-file__meta text-muted">{{ demoStatusLabel(demo.status) }} · {{ new Date(demo.uploaded_at).toLocaleDateString('ru-RU') }}</span>
                <span class="demo-file__download">↓ Скачать</span>
              </a>
            </div>
          </article>
        </div>
      </section>

      <h2 class="block-title" style="margin-top: 32px">Команды</h2>
      <div class="teams-grid">
        <div v-for="team in tournament.teams" :key="team.id" class="card team-card">
          <h3>{{ team.name }} <TeamElo :value="team.average_elo" /></h3>
          <ul class="team-roster">
            <li
              v-for="(slot, i) in rosterSlots(team)"
              :key="i"
              :class="{ 'team-roster__slot--empty': !slot.filled }"
            >
              <template v-if="slot.filled">
                <span class="avatar-row">
                  {{ slot.player.nickname }}
                  <span v-if="slot.player.is_captain" class="captain-tag" title="Капитан">C</span>
                </span>
                <span class="roster-stats">
                  <FaceitLevelBadge :level="faceitLevel(slot.player.seed_rating)" />
                  <span class="mono text-muted">
                    {{ slot.player.seed_rating != null ? Number(slot.player.seed_rating).toFixed(0) : '—' }}
                  </span>
                </span>
              </template>
              <span v-else class="text-muted">Свободный слот</span>
            </li>
          </ul>
        </div>
        <p v-if="tournament.teams.length === 0" class="text-muted">Команды ещё не сформированы.</p>
      </div>
    </section>

    <section class="rating-section">
      <h2 class="block-title">Рейтинг турнира</h2>
      <div class="card">
        <div class="scoreboard-row lb-row lb-row--head mono text-muted">
          <span></span>
          <span>Игрок</span>
          <span>Elo (FACEIT)</span>
          <span>Клубный рейтинг</span>
          <span></span>
        </div>
        <div v-for="(row, i) in leaderboard" :key="row.id" class="scoreboard-row lb-row">
          <span class="mono lb-rank">{{ i + 1 }}</span>
          <RouterLink :to="`/players/${row.id}`" class="lb-name avatar-row">
            <PlayerAvatar :nickname="row.nickname" :size="24" />
            {{ row.nickname }}
          </RouterLink>
          <span class="lb-elo-wrap">
            <FaceitLevelBadge :level="faceitLevel(row.seed_rating)" />
            <span class="mono lb-elo">{{ row.seed_rating != null ? Number(row.seed_rating).toFixed(0) : '—' }}</span>
          </span>
          <span class="mono lb-rating text-muted">{{ Number(row.rating).toFixed(0) }}</span>
          <RatingDelta :value="row.total_elo_change" />
        </div>
        <p v-if="leaderboard.length === 0" class="text-muted" style="padding: 16px">Пока нет данных.</p>
      </div>
      <p class="text-muted rating-hint">
        Пока по турниру не сыграно матчей, список отсортирован по Elo с FACEIT, указанному при регистрации —
        клубный рейтинг у всех ещё одинаковый и начнёт меняться после первых результатов.
      </p>
    </section>
  </div>
  <p v-else-if="loading" class="container text-muted">Загрузка…</p>
  <p v-else-if="loadError" class="container text-muted" role="status">{{ loadError }}</p>
</template>

<style scoped>
.results-hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(260px, .9fr);
  gap: 1px;
  margin: 4px 0 32px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--gold) 52%, var(--line));
  border-radius: calc(var(--radius) + 4px);
  background: color-mix(in srgb, var(--gold) 35%, var(--line));
  box-shadow: 0 18px 55px rgb(0 0 0 / 35%);
}
.results-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle at 16% 0%, color-mix(in srgb, var(--gold) 20%, transparent), transparent 44%);
}
.champion-panel, .mvp-panel { position: relative; background: var(--bg-elevated); }
.champion-panel { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 18px; padding: 28px 30px; }
.trophy { display: grid; place-items: center; width: 72px; height: 72px; border: 1px solid color-mix(in srgb, var(--gold) 60%, transparent); border-radius: 50%; color: var(--gold); background: color-mix(in srgb, var(--gold) 10%, var(--bg-inset)); font-size: 38px; box-shadow: inset 0 0 25px color-mix(in srgb, var(--gold) 12%, transparent); }
.result-label { margin-bottom: 5px; color: var(--gold); font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
.champion-copy h2 { font-size: clamp(25px, 4vw, 40px); line-height: 1.05; margin-bottom: 8px; }
.champion-roster { grid-column: 2; display: flex; flex-wrap: wrap; gap: 6px; margin-top: -6px; }
.champion-roster span { padding: 4px 8px; border: 1px solid var(--line); border-radius: 999px; color: var(--text-muted); font-size: 11px; }
.mvp-panel { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 14px; padding: 24px; color: var(--text); text-decoration: none; }
.mvp-panel:not(.mvp-panel--empty):hover { background: color-mix(in srgb, var(--gold) 6%, var(--bg-elevated)); }
.mvp-panel h3 { font-size: 22px; margin-bottom: 4px; }
.mvp-crown { color: var(--gold); font-size: 24px; }
.mvp-rating { grid-column: 2; display: flex; align-items: baseline; gap: 8px; }
.mvp-rating strong { color: var(--gold); font-size: 24px; }
.mvp-rating span { color: var(--text-muted); font-size: 11px; }
.demos-section { margin-top: 34px; }
.demos-heading { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 12px; }
.demos-heading h2 { font-size: 22px; }
.demo-count { padding: 5px 9px; border: 1px solid var(--line); border-radius: 999px; color: var(--text-muted); font-size: 11px; }
.demos-list { display: grid; gap: 12px; }
.demo-match { overflow: hidden; }
.demo-match__title { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.demo-match__title:hover strong { color: var(--red-strong); }
.demo-match__title span:nth-child(2) { display: grid; gap: 3px; min-width: 0; }
.demo-match__title strong, .demo-file__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.demo-match__title small { color: var(--text-muted); }
.demo-files { display: grid; }
.demo-file { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 11px 16px; border-bottom: 1px solid var(--line); color: var(--text); }
.demo-file:last-child { border-bottom: 0; }
.demo-file:hover { background: var(--bg-inset); }
.demo-file__type { width: fit-content; padding: 3px 6px; border: 1px solid color-mix(in srgb, var(--gold) 42%, var(--line)); border-radius: 4px; color: var(--gold); font-size: 10px; }
.demo-file__meta { font-size: 12px; }
.demo-file__download { color: var(--gold); font-size: 12px; font-weight: 700; }
@media (max-width: 760px) {
  .results-hero { grid-template-columns: 1fr; }
  .champion-panel { padding: 22px 18px; }
  .trophy { width: 58px; height: 58px; font-size: 30px; }
  .demo-file { grid-template-columns: 40px minmax(0, 1fr) auto; }
  .demo-file__meta { display: none; }
  .demo-file__download { font-size: 0; }
  .demo-file__download::after { content: '↓'; font-size: 18px; }
}
.t-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.t-format {
  font-family: var(--font-mono);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}

.t-desc {
  color: var(--text-muted);
  max-width: 640px;
  margin: 12px 0 16px;
  line-height: 1.6;
}

.t-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 32px;
}

.draft-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  margin-bottom: 32px;
  border: 1px solid color-mix(in srgb, var(--gold) 40%, var(--line));
  cursor: pointer;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, background 0.15s;
}

.draft-banner:hover {
  border-color: var(--gold);
  background: color-mix(in srgb, var(--gold) 6%, transparent);
}

.live-dot {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--gold);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--gold) 22%, transparent);
  animation: draft-pulse 1.6s ease-in-out infinite;
}

@keyframes draft-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.draft-banner__text {
  flex: 1;
  font-size: 14px;
}

.draft-banner__team {
  color: var(--gold);
}

.draft-banner__cta {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--gold);
}

.draft-finished-note {
  margin-bottom: 32px;
}

.rating-section {
  margin-top: 40px;
}

.rating-hint {
  margin-top: 10px;
  font-size: 12px;
}

.block-title {
  font-size: 18px;
  margin-bottom: 12px;
}

.match-row {
  grid-template-columns: auto 1fr auto;
  gap: 14px;
}

.match-row__teams {
  font-weight: 600;
}

.match-row__meta {
  font-size: 13px;
  margin-top: 2px;
}

.match-row__right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.score {
  font-size: 16px;
}

.teams-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

@media (max-width: 900px) {
  .teams-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 560px) {
  .teams-grid {
    grid-template-columns: 1fr;
  }
}

.team-card {
  padding: 16px;
}

.team-card h3 {
  font-size: 16px;
  margin-bottom: 10px;
}

.team-roster {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
}

.team-roster li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-sizing: border-box;
  height: 30px;
  padding: 2px 8px;
  border: 1px solid transparent;
  gap: 8px;
}

.team-roster .avatar-row {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

/* Пустой слот состава (см. rosterSlots) — пунктирная граница, чтобы явно
   читалось "здесь ещё нет игрока", а не как визуальный сбой вёрстки. */
.team-roster__slot--empty {
  border: 1px dashed var(--line);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
}

.roster-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.captain-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  color: var(--bg);
  background: var(--gold);
  flex: none;
}

.lb-row {
  display: grid;
  grid-template-columns: 32px 1fr 140px 140px 90px;
  gap: 10px;
  align-items: center;
}

@media (max-width: 640px) {
  /* 32+140+140+90 = 402px фикс. ширины колонок — почти весь экран
     телефона, ник просто не оставалось места показать. Убираем клубный
     рейтинг (он и так вторичный, см. комментарий у .lb-rating) и сужаем
     оставшиеся числовые колонки. */
  .lb-row {
    grid-template-columns: 24px 1fr 90px 50px;
    gap: 6px;
  }

  .lb-row > :nth-child(4) {
    display: none;
  }

  .lb-elo {
    font-size: 14px;
  }
}

@media (max-width: 400px) {
  /* На самых узких экранах (вплоть до ~340px) даже суженных 90+50 колонок
     не хватает, чтобы оставить месту под ник — убираем аватарку из строки
     рейтинга (она чисто декоративная, в отличие от профиля игрока) и ещё
     сильнее ужимаем числовые колонки и их шрифт. */
  .lb-row {
    grid-template-columns: 16px 1fr 60px 34px;
    gap: 4px;
  }

  .lb-name :deep(.player-avatar) {
    display: none;
  }

  .lb-name {
    font-size: 12.5px;
    gap: 0;
  }

  .lb-rank {
    font-size: 11px;
  }

  .lb-elo-wrap {
    gap: 3px;
  }

  .lb-elo {
    font-size: 11px;
  }

  /* RatingDelta ("▲ +12.0") — без min-width:0 контент грид-ячейки не
     сжимается меньше своего содержимого и раздувает всю строку вширь
     (тот же баг, что уже чинили в MatchDetailView). */
  .lb-row > :nth-child(5) {
    font-size: 11px;
    min-width: 0;
  }
}

.lb-row--head {
  text-transform: uppercase;
  font-size: 11px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-inset);
}

.lb-rank {
  color: var(--text-dim);
}

.lb-name {
  font-weight: 600;
}

.lb-name:hover {
  color: var(--red-strong);
}

.lb-elo-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Elo с FACEIT — сейчас, до старта матчей, самая содержательная цифра. */
.lb-elo {
  font-size: 16px;
  font-weight: 700;
  color: var(--gold);
}

/* Клубный рейтинг RIFT: пока не сыграно ни одного матча, он одинаковый у
   всех (1000) и малоинформативен — визуально отходит на второй план. */
.lb-rating {
  font-size: 13px;
}
</style>
