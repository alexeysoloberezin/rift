<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import apiClient from '../api/client';
import DraftBoard from '../components/DraftBoard.vue';
import { withScrollPreserved } from '../lib/scroll';

// Публичная зрительская страница драфта — только просмотр (пикают
// капитаны по своей приватной ссылке /draft/:token, см. DraftCaptainView).
// Поллинг, пока драфт активен, чтобы зрители видели пики в реальном времени.

const route = useRoute();
const tournament = ref(null);
const draft = ref(null);
const loading = ref(true);
let pollTimer = null;

async function load() {
  // withScrollPreserved — чтобы поллинг раз в 3 сек (пока драфт активен) не
  // сбрасывал скролл страницы в начало при каждом обновлении пула игроков.
  await withScrollPreserved(async () => {
    const [{ data: tData }, { data: dData }] = await Promise.all([
      apiClient.get(`/tournaments/${route.params.id}`),
      apiClient.get(`/tournaments/${route.params.id}/draft`),
    ]);
    tournament.value = tData.data;
    draft.value = dData.data;
    loading.value = false;
  });

  clearTimeout(pollTimer);
  if (draft.value && draft.value.status === 'active') {
    pollTimer = setTimeout(load, 3000);
  }
}

onMounted(load);
onUnmounted(() => clearTimeout(pollTimer));
</script>

<template>
  <div class="container" v-if="!loading && tournament">
    <div class="page-head">
      <div>
        <p class="text-muted eyebrow">{{ tournament.name }}</p>
        <h1>Драфт капитанов</h1>
      </div>
      <RouterLink :to="`/tournaments/${tournament.id}`" class="btn">← К турниру</RouterLink>
    </div>

    <DraftBoard v-if="draft" :data="draft" />
    <p v-else class="text-muted empty-note">Драфт для этого турнира ещё не запущен организатором.</p>
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
</style>
