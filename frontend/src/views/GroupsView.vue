<script setup>
import TeamElo from '../components/TeamElo.vue';
import { computed, onMounted, ref } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import apiClient from '../api/client';
import StatusBadge from '../components/StatusBadge.vue';
import MapBadge from '../components/MapBadge.vue';

const route = useRoute();
const tournament = ref(null);
const groups = ref([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  const [{ data: tData }, { data: gData }] = await Promise.all([
    apiClient.get(`/tournaments/${route.params.id}`),
    apiClient.get(`/tournaments/${route.params.id}/groups`),
  ]);
  tournament.value = tData.data;
  groups.value = gData.data;
  loading.value = false;
}

onMounted(load);

// Простая турнирная таблица группы: победы/поражения по сыгранным матчам
// этой группы (только там, где есть счёт и он не ничейный — в CS2 матчи
// вничью не заканчиваются, но защищаемся на случай ручного ввода).
function standingsFor(group) {
  const stats = new Map(group.teams.map((t) => [t.id, { team: t, w: 0, l: 0 }]));
  for (const m of group.matches) {
    if (m.score_a == null || m.score_b == null || m.score_a === m.score_b) continue;
    const winnerId = m.score_a > m.score_b ? m.team_a_id : m.team_b_id;
    const loserId = m.score_a > m.score_b ? m.team_b_id : m.team_a_id;
    if (stats.has(winnerId)) stats.get(winnerId).w += 1;
    if (stats.has(loserId)) stats.get(loserId).l += 1;
  }
  return [...stats.values()].sort((a, b) => b.w - a.w || a.l - b.l);
}

const standingsByGroup = computed(() => new Map(groups.value.map((g) => [g.id, standingsFor(g)])));

// Из каждой группы в плей-офф выходят 2 верхние команды таблицы (см.
// standingsFor выше — уже отсортировано по числу побед).
const QUALIFY_COUNT = 2;
</script>

<template>
  <div class="container" v-if="!loading && tournament">
    <div class="page-head">
      <div>
        <p class="text-muted eyebrow">{{ tournament.name }}</p>
        <h1>Группы</h1>
      </div>
      <RouterLink :to="`/tournaments/${tournament.id}`" class="btn">← К турниру</RouterLink>
    </div>

    <p v-if="groups.length === 0" class="text-muted empty-note">
      Групповой этап для этого турнира ещё не настроен организатором.
    </p>

    <div v-else class="groups-grid">
      <section v-for="group in groups" :key="group.id" class="card group-card">
        <h2 class="group-title">{{ group.name }}</h2>

        <div class="standings" v-if="group.teams.length">
          <div class="standings-head mono text-muted">
            <span></span>
            <span>Команда</span>
            <span>В</span>
            <span>П</span>
          </div>
          <div
            v-for="(row, i) in standingsByGroup.get(group.id)"
            :key="row.team.id"
            class="standings-row"
            :class="{ 'standings-row--qualified': i < QUALIFY_COUNT }"
          >
            <span class="standings-rank mono">{{ i + 1 }}</span>
            <span>{{ row.team.name }} <TeamElo :value="row.team.total_elo" /></span>
            <span class="mono">{{ row.w }}</span>
            <span class="mono">{{ row.l }}</span>
          </div>
        </div>
        <p v-else class="text-muted">Команды в эту группу ещё не добавлены.</p>
        <p v-if="group.teams.length" class="text-muted qualify-note">
          <span class="qualify-dot"></span> — топ-2 команды группы выходят в плей-офф
        </p>

        <h3 class="matches-title">Результаты встреч</h3>
        <div class="matches-list" v-if="group.matches.length">
          <RouterLink
            v-for="m in group.matches"
            :key="m.id"
            :to="`/matches/${m.id}`"
            class="scoreboard-row match-row"
          >
            <MapBadge :map="m.map" size="sm" :show-label="false" />
            <div class="match-row__teams">
              {{ m.team_a_name || 'TBD' }} <TeamElo v-if="m.team_a_name" :value="m.team_a_elo" /> <span class="text-muted">vs</span> {{ m.team_b_name || 'TBD' }} <TeamElo v-if="m.team_b_name" :value="m.team_b_elo" />
            </div>
            <div class="match-row__right">
              <span v-if="m.score_a !== null" class="mono">{{ m.score_a }}:{{ m.score_b }}</span>
              <StatusBadge :status="m.status" />
            </div>
          </RouterLink>
        </div>
        <p v-else class="text-muted">Матчи в этой группе ещё не назначены.</p>
      </section>
    </div>
  </div>
  <p v-else-if="loading" class="container text-muted">Загрузка…</p>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
}

.eyebrow {
  font-family: var(--font-mono);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}

.empty-note {
  padding: 32px 0;
}

.groups-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

@media (max-width: 780px) {
  .groups-grid {
    grid-template-columns: 1fr;
  }
}

.group-card {
  padding: 20px;
}

.group-title {
  font-size: 20px;
  margin-bottom: 14px;
}

.standings {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  margin-bottom: 20px;
}

.standings-head,
.standings-row {
  display: grid;
  grid-template-columns: 18px 1fr 32px 32px;
  gap: 8px;
  padding: 8px 12px;
  align-items: center;
}

.standings-head {
  text-transform: uppercase;
  font-size: 11px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-inset);
}

.standings-row {
  border-bottom: 1px solid var(--line);
  font-size: 14px;
  border-left: 2px solid transparent;
}

.standings-row:last-child {
  border-bottom: none;
}

.standings-rank {
  color: var(--text-muted);
}

/* Топ-2 команды группы — выходят в плей-офф (см. QUALIFY_COUNT). */
.standings-row--qualified {
  border-left-color: var(--gold);
  background: color-mix(in srgb, var(--gold) 8%, transparent);
}

.standings-row--qualified .standings-rank {
  color: var(--gold);
  font-weight: 700;
}

.qualify-note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  margin: -12px 0 20px;
}

.qualify-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--gold);
}

.matches-title {
  font-size: 15px;
  margin-bottom: 8px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.matches-list {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}

.match-row {
  grid-template-columns: auto 1fr auto;
  gap: 12px;
}

.match-row__teams {
  font-weight: 600;
  font-size: 14px;
}

.match-row__right {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
