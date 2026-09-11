<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import { VueFlow } from '@vue-flow/core';
import '@vue-flow/core/dist/style.css';
import apiClient from '../api/client';
import StatusBadge from '../components/StatusBadge.vue';

// Плей-офф сетка турнира: полуфинал (2 матча) -> финал (1 матч), см.
// backend/src/routes/bracket.routes.js. Это только визуализация фиксированных
// слотов, которые расставляет админ (frontend/src/views/admin/AdminBracketView.vue) —
// сама эта страница только читает и рисует, ничего не редактирует.
//
// Рисуем через @vue-flow/core (см. package.json) — библиотека НЕ проверена
// сборкой в песочнице, где это писалось (нет доступа к npm-реестру, поставить
// пакет и прогнать `npm run build` не вышло). Если после `npm install` что-то
// в проп-именах/событиях не срастётся — сверьтесь с текущей документацией
// @vue-flow/core, статическую разметку узлов/рёбер ниже трогать не придётся.

const route = useRoute();
const tournament = ref(null);
const slots = ref([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  const [{ data: tData }, { data: bData }] = await Promise.all([
    apiClient.get(`/tournaments/${route.params.id}`),
    apiClient.get(`/tournaments/${route.params.id}/bracket`),
  ]);
  tournament.value = tData.data;
  slots.value = bData.data;
  loading.value = false;
}

onMounted(load);

function findSlot(round, slotIndex) {
  return slots.value.find((s) => s.round === round && s.slot_index === slotIndex);
}

const nodes = computed(() => {
  const sf0 = findSlot('semifinal', 0);
  const sf1 = findSlot('semifinal', 1);
  const final = findSlot('final', 0);
  const list = [];
  if (sf0) list.push({ id: sf0.id, type: 'slot', position: { x: 0, y: 0 }, data: { ...sf0, label: 'Полуфинал 1' } });
  if (sf1) list.push({ id: sf1.id, type: 'slot', position: { x: 0, y: 190 }, data: { ...sf1, label: 'Полуфинал 2' } });
  if (final)
    list.push({
      id: final.id,
      type: 'slot',
      position: { x: 380, y: 95 },
      data: { ...final, label: 'Финал', isFinal: true },
    });
  return list;
});

const edges = computed(() => {
  const sf0 = findSlot('semifinal', 0);
  const sf1 = findSlot('semifinal', 1);
  const final = findSlot('final', 0);
  const list = [];
  if (sf0 && final) list.push({ id: `e-${sf0.id}`, source: sf0.id, target: final.id, type: 'smoothstep' });
  if (sf1 && final) list.push({ id: `e-${sf1.id}`, source: sf1.id, target: final.id, type: 'smoothstep' });
  return list;
});

function isWinner(data, side) {
  if (data.match_score_a == null || data.match_score_b == null || data.match_score_a === data.match_score_b) {
    return false;
  }
  return side === 'a' ? data.match_score_a > data.match_score_b : data.match_score_b > data.match_score_a;
}
</script>

<template>
  <div class="container" v-if="!loading && tournament">
    <div class="page-head">
      <div>
        <p class="text-muted eyebrow">{{ tournament.name }}</p>
        <h1>Плей-офф</h1>
      </div>
      <RouterLink :to="`/tournaments/${tournament.id}`" class="btn">← К турниру</RouterLink>
    </div>

    <p v-if="slots.length === 0" class="text-muted empty-note">
      Сетка плей-офф для этого турнира ещё не настроена организатором.
    </p>

    <div v-else class="card bracket-wrap">
      <VueFlow
        :nodes="nodes"
        :edges="edges"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :edges-updatable="false"
        :zoom-on-scroll="false"
        :zoom-on-double-click="false"
        :pan-on-drag="true"
        fit-view-on-init
        class="bracket-flow"
      >
        <template #node-slot="{ data }">
          <div class="bracket-node" :class="{ 'bracket-node--final': data.isFinal }">
            <div class="bracket-node__round">{{ data.label }}</div>
            <div class="bracket-node__team" :class="{ 'bracket-node__team--winner': isWinner(data, 'a') }">
              <span class="bracket-node__name">{{ data.team_a_name || 'TBD' }}</span>
              <span v-if="data.match_score_a !== null" class="mono">{{ data.match_score_a }}</span>
            </div>
            <div class="bracket-node__team" :class="{ 'bracket-node__team--winner': isWinner(data, 'b') }">
              <span class="bracket-node__name">{{ data.team_b_name || 'TBD' }}</span>
              <span v-if="data.match_score_b !== null" class="mono">{{ data.match_score_b }}</span>
            </div>
            <RouterLink v-if="data.match_id" :to="`/matches/${data.match_id}`" class="bracket-node__link">
              <StatusBadge :status="data.match_status" />
            </RouterLink>
          </div>
        </template>
      </VueFlow>
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

.bracket-wrap {
  padding: 8px;
  height: 460px;
}

.bracket-flow {
  width: 100%;
  height: 100%;
  background: transparent;
}

.bracket-flow :deep(.vue-flow__edge-path) {
  stroke: var(--line);
  stroke-width: 2;
}

.bracket-flow :deep(.vue-flow__background) {
  display: none;
}

.bracket-node {
  width: 240px;
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.bracket-node--final {
  border-color: var(--red-dim);
}

.bracket-node__round {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-inset);
}

.bracket-node__team {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}

.bracket-node__team:last-of-type {
  border-bottom: none;
}

.bracket-node__name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bracket-node__team--winner .bracket-node__name,
.bracket-node__team--winner .mono {
  color: var(--gold);
}

.bracket-node__link {
  display: block;
  padding: 8px 12px;
}
</style>
