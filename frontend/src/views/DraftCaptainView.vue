<script setup>
import TeamElo from '../components/TeamElo.vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import apiClient from '../api/client';
import DraftBoard from '../components/DraftBoard.vue';
import { withScrollPreserved } from '../lib/scroll';

// Капитанская страница драфта — доступ по секретной ссылке /draft/:token,
// без логина (см. draft.routes.js GET/POST .../draft/captain/:token). Тот же
// DraftBoard, что и на публичной странице турнира, но с возможностью
// пикать, когда сейчас ход этого капитана.

const route = useRoute();
const data = ref(null);
const loading = ref(true);
const notFound = ref(false);
const picking = ref(false);
const pickError = ref('');
let pollTimer = null;

async function load() {
  // withScrollPreserved — чтобы поллинг раз в 2.5 сек (пока драфт активен) и
  // рефетч после собственного пика не сбрасывали скролл страницы в начало.
  await withScrollPreserved(async () => {
    try {
      const { data: res } = await apiClient.get(`/draft/captain/${route.params.token}`);
      data.value = res.data;
      notFound.value = false;
    } catch (e) {
      if (e.response?.status === 404) notFound.value = true;
    } finally {
      loading.value = false;
    }
  });

  clearTimeout(pollTimer);
  if (data.value && data.value.status === 'active') {
    pollTimer = setTimeout(load, 2500);
  }
}

onMounted(load);
onUnmounted(() => clearTimeout(pollTimer));

const isMyTurn = computed(
  () => data.value && data.value.status === 'active' && data.value.current_team_id === data.value.my_team_id
);

const myTeam = computed(() => data.value?.teams.find((t) => t.team_id === data.value.my_team_id));

async function onPick(playerId) {
  if (!isMyTurn.value || picking.value) return;
  pickError.value = '';
  picking.value = true;
  try {
    await apiClient.post(`/draft/captain/${route.params.token}/pick`, { player_id: playerId });
    await load();
  } catch (e) {
    pickError.value = e.response?.data?.error || 'Не удалось выбрать игрока';
    await load(); // могли разойтись с реальным состоянием (гонка) — подтянуть актуальное
  } finally {
    picking.value = false;
  }
}
</script>

<template>
  <div class="container" v-if="!loading">
    <template v-if="notFound">
      <p class="text-muted empty-note">Эта ссылка недействительна. Уточните актуальную ссылку у организатора.</p>
    </template>
    <template v-else-if="data">
      <div class="page-head">
        <div>
          <p class="text-muted eyebrow">{{ data.tournament_name }}</p>
          <h1>Драфт — {{ myTeam?.team_name }} <TeamElo :value="myTeam?.average_elo" /></h1>
        </div>
        <div class="turn-banner" :class="{ 'turn-banner--active': isMyTurn }">
          {{ data.status === 'finished' ? 'Драфт завершён' : isMyTurn ? 'Ваш ход — выберите игрока' : 'Ожидание хода других капитанов…' }}
        </div>
      </div>
      <p v-if="pickError" class="delta-negative pick-error">{{ pickError }}</p>
      <DraftBoard :data="data" :can-pick="isMyTurn" :picking="picking" @pick="onPick" />
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
  margin-bottom: 20px;
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

.turn-banner {
  padding: 10px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--bg-inset);
  color: var(--text-muted);
  font-weight: 600;
  font-size: 14px;
}

.turn-banner--active {
  border-color: var(--gold);
  color: var(--gold);
  background: color-mix(in srgb, var(--gold) 10%, transparent);
}

.pick-error {
  margin-bottom: 12px;
}
</style>
