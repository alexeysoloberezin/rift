<script setup>
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import apiClient from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import StatusBadge from '../../components/StatusBadge.vue';

const auth = useAuthStore();
const tournaments = ref([]);
const loading = ref(true);

onMounted(async () => {
  const { data } = await apiClient.get('/tournaments');
  tournaments.value = data.data;
  loading.value = false;
});
</script>

<template>
  <div class="container">
    <div class="page-head">
      <div>
        <p class="text-muted">Добро пожаловать, {{ auth.admin?.name }}</p>
        <h1>Админ-панель</h1>
      </div>
      <RouterLink to="/admin/map-veto" class="btn">Пики карт</RouterLink>
      <RouterLink to="/admin/tournaments/new" class="btn btn-primary">+ Новый турнир</RouterLink>
    </div>

    <p v-if="loading" class="text-muted">Загрузка…</p>
    <div v-else class="card">
      <RouterLink
        v-for="t in tournaments"
        :key="t.id"
        :to="`/admin/tournaments/${t.id}`"
        class="scoreboard-row row"
      >
        <span class="row__name">{{ t.name }}</span>
        <span class="mono text-muted">{{ t.players_count }} игроков</span>
        <StatusBadge :status="t.status" />
      </RouterLink>
      <p v-if="tournaments.length === 0" class="text-muted" style="padding: 16px">
        Турниров ещё нет — создайте первый.
      </p>
    </div>
  </div>
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

.page-head h1 {
  font-size: 32px;
}

.row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 16px;
  align-items: center;
}

.row__name {
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 480px) {
  .row {
    grid-template-columns: 1fr auto;
  }
  .row__name {
    grid-column: 1 / -1;
    white-space: normal;
  }
}
</style>
