<script setup>
import TeamElo from '../../components/TeamElo.vue';
import { computed, onMounted, ref } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import { VueFlow } from '@vue-flow/core';
import '@vue-flow/core/dist/style.css';
import apiClient from '../../api/client';
import StatusBadge from '../../components/StatusBadge.vue';

// Админка плей-офф сетки: фиксированная форма "полуфинал (2 матча) -> финал
// (1 матч)" — см. backend/src/routes/bracket.routes.js. Админ здесь только
// расставляет команды по слотам и, отдельно, привязывает к слоту уже
// загруженный/обработанный матч как результат встречи — без автоматики
// (никакого авто-посева и авто-проброса победителя в финал).
//
// @vue-flow/core не проверен сборкой в этой песочнице (нет доступа к
// npm-реестру) — визуальная сетка сверху используется только для наглядности
// "что где стоит"; реальное редактирование — в обычных select'ах формы ниже,
// так что даже если у библиотеки после `npm install` разойдутся какие-то
// мелочи в API, редактирование слотов это не сломает.

const route = useRoute();
const tournamentId = route.params.id;

const tournament = ref(null);
const slots = ref([]);
const loading = ref(true);

const initializing = ref(false);
const initError = ref('');

const drafts = ref({}); // slot_id -> { team_a_id, team_b_id, match_id }
const savingSlotId = ref(null);
const slotError = ref({}); // slot_id -> сообщение об ошибке
const selectedSlotId = ref(null);

function slotLabel(s) {
  if (s.round === 'final') return 'Финал';
  return `Полуфинал ${s.slot_index + 1}`;
}

function matchLabel(m) {
  const score = m.score_a != null ? ` (${m.score_a}:${m.score_b})` : '';
  return `${m.team_a_name || 'TBD'} vs ${m.team_b_name || 'TBD'}${score}`;
}

async function loadAll() {
  const [{ data: tData }, { data: bData }] = await Promise.all([
    apiClient.get(`/tournaments/${tournamentId}`),
    apiClient.get(`/tournaments/${tournamentId}/bracket`),
  ]);
  tournament.value = tData.data;
  slots.value = bData.data;
  for (const s of slots.value) {
    drafts.value[s.id] = {
      team_a_id: s.team_a_id || '',
      team_b_id: s.team_b_id || '',
      match_id: s.match_id || '',
    };
  }
  loading.value = false;
}

onMounted(loadAll);

async function initBracket() {
  initError.value = '';
  initializing.value = true;
  try {
    await apiClient.post(`/tournaments/${tournamentId}/bracket/init`);
    await loadAll();
  } catch (e) {
    initError.value = e.response?.data?.error || 'Не удалось создать сетку';
  } finally {
    initializing.value = false;
  }
}

async function saveSlot(slot) {
  slotError.value = { ...slotError.value, [slot.id]: '' };
  const draft = drafts.value[slot.id];
  if (draft.team_a_id && draft.team_b_id && draft.team_a_id === draft.team_b_id) {
    slotError.value = { ...slotError.value, [slot.id]: 'Команда A и команда B не могут совпадать' };
    return;
  }
  savingSlotId.value = slot.id;
  try {
    await apiClient.put(`/bracket-slots/${slot.id}`, {
      team_a_id: draft.team_a_id || null,
      team_b_id: draft.team_b_id || null,
      match_id: draft.match_id || null,
    });
    await loadAll();
  } catch (e) {
    slotError.value = { ...slotError.value, [slot.id]: e.response?.data?.error || 'Не удалось сохранить слот' };
  } finally {
    savingSlotId.value = null;
  }
}

function findSlot(round, slotIndex) {
  return slots.value.find((s) => s.round === round && s.slot_index === slotIndex);
}

const nodes = computed(() => {
  const sf0 = findSlot('semifinal', 0);
  const sf1 = findSlot('semifinal', 1);
  const final = findSlot('final', 0);
  const list = [];
  if (sf0) list.push({ id: sf0.id, type: 'slot', position: { x: 0, y: 0 }, data: sf0 });
  if (sf1) list.push({ id: sf1.id, type: 'slot', position: { x: 0, y: 170 }, data: sf1 });
  if (final) list.push({ id: final.id, type: 'slot', position: { x: 360, y: 85 }, data: final });
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

function onNodeClick({ node }) {
  selectedSlotId.value = node.id;
}
</script>

<template>
  <div class="container" v-if="!loading && tournament">
    <div class="page-head">
      <h1>Плей-офф — {{ tournament.name }}</h1>
      <RouterLink :to="`/admin/tournaments/${tournamentId}`" class="btn">← К турниру</RouterLink>
    </div>

    <section v-if="slots.length === 0" class="card block">
      <h2>Сетка ещё не настроена</h2>
      <p class="text-muted hint">Создаст 3 пустых слота: полуфинал 1, полуфинал 2 и финал.</p>
      <button class="btn btn-primary" :disabled="initializing" @click="initBracket">
        {{ initializing ? 'Создаём…' : 'Создать сетку' }}
      </button>
      <p v-if="initError" class="delta-negative">{{ initError }}</p>
    </section>

    <template v-else>
      <div class="card bracket-wrap">
        <VueFlow
          :nodes="nodes"
          :edges="edges"
          :nodes-draggable="false"
          :nodes-connectable="false"
          :edges-updatable="false"
          :zoom-on-scroll="false"
          :zoom-on-double-click="false"
          pan-on-drag
          fit-view-on-init
          class="bracket-flow"
          @node-click="onNodeClick"
        >
          <template #node-slot="{ data }">
            <div class="bracket-node" :class="{ 'bracket-node--selected': selectedSlotId === data.id }">
              <div class="bracket-node__round">{{ slotLabel(data) }}</div>
              <div class="bracket-node__team">{{ data.team_a_name || 'TBD' }} <TeamElo v-if="data.team_a_name" :value="data.team_a_elo" /></div>
              <div class="bracket-node__team">{{ data.team_b_name || 'TBD' }} <TeamElo v-if="data.team_b_name" :value="data.team_b_elo" /></div>
            </div>
          </template>
        </VueFlow>
      </div>
      <p class="text-muted flow-hint">Клик по узлу подсветит соответствующую форму ниже.</p>

      <section
        v-for="slot in slots"
        :key="slot.id"
        class="card block slot-block"
        :class="{ 'slot-block--selected': selectedSlotId === slot.id }"
      >
        <h2>{{ slotLabel(slot) }}</h2>
        <div class="form-grid">
          <select v-model="drafts[slot.id].team_a_id">
            <option value="">Команда A — TBD</option>
            <option v-for="t in tournament.teams" :key="t.id" :value="t.id">{{ t.name }} · Σ Elo {{ t.total_elo == null ? '—' : Number(t.total_elo).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) }}</option>
          </select>
          <select v-model="drafts[slot.id].team_b_id">
            <option value="">Команда B — TBD</option>
            <option v-for="t in tournament.teams" :key="t.id" :value="t.id">{{ t.name }} · Σ Elo {{ t.total_elo == null ? '—' : Number(t.total_elo).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) }}</option>
          </select>
          <select v-model="drafts[slot.id].match_id" class="match-select">
            <option value="">Без привязанного матча</option>
            <option v-for="m in tournament.matches" :key="m.id" :value="m.id">{{ matchLabel(m) }}</option>
          </select>
          <button class="btn btn-primary" :disabled="savingSlotId === slot.id" @click="saveSlot(slot)">
            {{ savingSlotId === slot.id ? 'Сохраняем…' : 'Сохранить' }}
          </button>
        </div>
        <p v-if="slot.match_id" class="text-muted linked-match">
          Привязан матч: <RouterLink :to="`/matches/${slot.match_id}`">открыть</RouterLink>
          <StatusBadge v-if="slot.match_status" :status="slot.match_status" />
        </p>
        <p v-if="slotError[slot.id]" class="delta-negative">{{ slotError[slot.id] }}</p>
      </section>
    </template>
  </div>
  <p v-else class="container text-muted">Загрузка…</p>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
}

.page-head h1 {
  font-size: 28px;
}

.block {
  padding: 24px;
  margin-bottom: 24px;
}

.block h2 {
  font-size: 18px;
  margin-bottom: 8px;
}

.hint {
  font-size: 13px;
  margin-bottom: 16px;
}

.bracket-wrap {
  padding: 8px;
  height: 380px;
  margin-bottom: 8px;
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
  width: 220px;
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.bracket-node--selected {
  border-color: var(--red-strong);
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
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
  font-weight: 600;
}

.bracket-node__team:last-child {
  border-bottom: none;
}

.flow-hint {
  font-size: 12px;
  margin-bottom: 20px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1.6fr auto;
  gap: 10px;
}

.slot-block {
  transition: border-color 0.15s ease;
}

.slot-block--selected {
  border-color: var(--red-strong);
}

.linked-match {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.linked-match a {
  color: var(--red-strong);
  font-weight: 600;
}

@media (max-width: 640px) {
  .bracket-wrap {
    height: 300px;
  }

  .bracket-node {
    width: 180px;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
