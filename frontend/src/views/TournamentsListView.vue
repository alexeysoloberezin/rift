<script setup>
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import apiClient from '../api/client';
import StatusBadge from '../components/StatusBadge.vue';

const tournaments = ref([]);
const loading = ref(true);
const error = ref(null);

onMounted(async () => {
  try {
    const { data } = await apiClient.get('/tournaments');
    tournaments.value = data.data;
  } catch (e) {
    error.value = 'Не удалось загрузить турниры';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="container">
    <h1 class="page-title">Турниры</h1>

    <p v-if="loading" class="text-muted">Загрузка…</p>
    <p v-else-if="error" class="delta-negative">{{ error }}</p>
    <p v-else-if="tournaments.length === 0" class="text-muted">Пока нет ни одного турнира.</p>

    <div v-else class="grid">
      <RouterLink v-for="t in tournaments" :key="t.id" :to="`/tournaments/${t.id}`" class="card t-card">
        <div class="t-card__head">
          <h3>{{ t.name }}</h3>
          <StatusBadge :status="t.status" />
        </div>
        <p class="text-muted t-card__desc">{{ t.description || 'Без описания' }}</p>
        <div class="t-card__stats mono">
          <span>{{ t.players_count }} игроков</span>
          <span>{{ t.matches_count }} матчей</span>
        </div>
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.page-title {
  font-size: 32px;
  margin-bottom: 24px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.t-card {
  padding: 20px;
  display: block;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.t-card:hover {
  border-color: var(--red);
}

.t-card__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;
}

.t-card__head h3 {
  font-size: 20px;
}

.t-card__desc {
  font-size: 14px;
  line-height: 1.5;
  min-height: 42px;
  margin-bottom: 14px;
}

.t-card__stats {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-muted);
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
</style>
