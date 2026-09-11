<script setup>
import { onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import apiClient from '../api/client';
import PlayerAvatar from '../components/PlayerAvatar.vue';

const players = ref([]);
const search = ref('');
const loading = ref(true);

async function load() {
  loading.value = true;
  const { data } = await apiClient.get('/players', { params: search.value ? { search: search.value } : {} });
  players.value = data.data;
  loading.value = false;
}

onMounted(load);

let debounceTimer;
watch(search, () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(load, 300);
});
</script>

<template>
  <div class="container">
    <div class="page-head">
      <h1>Рейтинг игроков клуба</h1>
      <input v-model="search" type="text" placeholder="Поиск по нику…" class="search-input" />
    </div>

    <p v-if="loading" class="text-muted">Загрузка…</p>
    <div v-else class="card">
      <div class="scoreboard-row list-head mono text-muted">
        <span>#</span>
        <span>Игрок</span>
        <span>Рейтинг</span>
        <span>Матчей</span>
      </div>
      <RouterLink v-for="(p, i) in players" :key="p.id" :to="`/players/${p.id}`" class="scoreboard-row list-row">
        <span class="mono text-dim">{{ i + 1 }}</span>
        <span class="list-row__name avatar-row">
          <PlayerAvatar :nickname="p.nickname" :size="26" />
          {{ p.nickname }}
        </span>
        <span class="mono">{{ Number(p.rating).toFixed(0) }}</span>
        <span class="mono text-muted">{{ p.matches_played }}</span>
      </RouterLink>
      <p v-if="players.length === 0" class="text-muted" style="padding: 16px">Игроки не найдены.</p>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-head h1 {
  font-size: 32px;
}

.search-input {
  width: 240px;
}

.list-head,
.list-row {
  display: grid;
  grid-template-columns: 40px 1fr 120px 100px;
  align-items: center;
}

.list-head {
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--line);
}

.text-dim {
  color: var(--text-dim);
}

.list-row__name {
  font-weight: 600;
}

@media (max-width: 560px) {
  .page-head {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .page-head h1 {
    font-size: 24px;
  }

  .search-input {
    width: 100%;
  }

  /* На узком экране 4 колонки (40/1fr/120/100) уже не помещаются — ник
     наезжал на "Рейтинг". Убираем наименее важную колонку (число матчей,
     оно и так есть в профиле игрока) и сужаем оставшиеся. */
  .list-head,
  .list-row {
    grid-template-columns: 28px 1fr 64px;
    gap: 6px;
  }

  .list-head > :nth-child(4),
  .list-row > :nth-child(4) {
    display: none;
  }
}
</style>
