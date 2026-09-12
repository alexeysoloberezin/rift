<script setup>
import TeamElo from '../../components/TeamElo.vue';
import { computed, onMounted, ref } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import apiClient from '../../api/client';

const route = useRoute();
const tournamentId = route.params.id;

const tournament = ref(null);
const groups = ref([]);
const loading = ref(true);

const initializing = ref(false);
const initError = ref('');

const nameDrafts = ref({}); // group_id -> строка в поле ввода (черновик переименования)
const savingNameFor = ref(null);
const nameError = ref('');

const assigningTeamId = ref(null);
const assignError = ref('');

async function loadAll() {
  const [{ data: tData }, { data: gData }] = await Promise.all([
    apiClient.get(`/tournaments/${tournamentId}`),
    apiClient.get(`/tournaments/${tournamentId}/groups`),
  ]);
  tournament.value = tData.data;
  groups.value = gData.data;
  for (const g of groups.value) {
    if (!(g.id in nameDrafts.value)) nameDrafts.value[g.id] = g.name;
  }
  loading.value = false;
}

onMounted(loadAll);

// team_id -> group_id, для того чтобы знать текущее назначение команды в
// выпадающем списке ниже (сама команда может стоять максимум в одной группе).
const teamGroupId = computed(() => {
  const map = {};
  for (const g of groups.value) {
    for (const t of g.teams) map[t.id] = g.id;
  }
  return map;
});

async function initGroups() {
  initError.value = '';
  initializing.value = true;
  try {
    await apiClient.post(`/tournaments/${tournamentId}/groups/init`);
    await loadAll();
  } catch (e) {
    initError.value = e.response?.data?.error || 'Не удалось создать группы';
  } finally {
    initializing.value = false;
  }
}

async function saveName(group) {
  nameError.value = '';
  savingNameFor.value = group.id;
  try {
    await apiClient.put(`/groups/${group.id}`, { name: nameDrafts.value[group.id] });
    await loadAll();
  } catch (e) {
    nameError.value = e.response?.data?.error || 'Не удалось переименовать группу';
  } finally {
    savingNameFor.value = null;
  }
}

async function onAssignChange(teamId, e) {
  const newGroupId = e.target.value || null;
  assignError.value = '';
  assigningTeamId.value = teamId;
  try {
    const currentGroupId = teamGroupId.value[teamId];
    if (currentGroupId && currentGroupId !== newGroupId) {
      await apiClient.delete(`/groups/${currentGroupId}/teams/${teamId}`);
    }
    if (newGroupId) {
      await apiClient.put(`/groups/${newGroupId}/teams/${teamId}`);
    }
    await loadAll();
  } catch (e) {
    assignError.value = e.response?.data?.error || 'Не удалось назначить группу';
  } finally {
    assigningTeamId.value = null;
  }
}
</script>

<template>
  <div class="container" v-if="!loading && tournament">
    <div class="page-head">
      <h1>Группы — {{ tournament.name }}</h1>
      <RouterLink :to="`/admin/tournaments/${tournamentId}`" class="btn">← К турниру</RouterLink>
    </div>

    <section v-if="groups.length === 0" class="card block">
      <h2>Групповой этап ещё не настроен</h2>
      <p class="text-muted hint">
        Создаст ровно 2 группы («Группа A» и «Группа B») — дальше их можно переименовать и распределить по ним команды.
      </p>
      <button class="btn btn-primary" :disabled="initializing" @click="initGroups">
        {{ initializing ? 'Создаём…' : 'Создать группы' }}
      </button>
      <p v-if="initError" class="delta-negative">{{ initError }}</p>
    </section>

    <template v-else>
      <section class="card block">
        <h2>Названия групп</h2>
        <div class="rename-row" v-for="g in groups" :key="g.id">
          <input v-model="nameDrafts[g.id]" type="text" />
          <button class="btn" :disabled="savingNameFor === g.id || nameDrafts[g.id] === g.name" @click="saveName(g)">
            {{ savingNameFor === g.id ? 'Сохраняем…' : 'Сохранить' }}
          </button>
        </div>
        <p v-if="nameError" class="delta-negative">{{ nameError }}</p>
      </section>

      <section class="card block">
        <h2>Распределение команд</h2>
        <p class="text-muted hint">Выберите группу для каждой команды турнира — «—» уберёт команду из групп.</p>
        <div class="teams-assign" v-if="tournament.teams.length">
          <div class="scoreboard-row assign-head mono text-muted">
            <span>Команда</span>
            <span>Группа</span>
          </div>
          <div v-for="t in tournament.teams" :key="t.id" class="scoreboard-row assign-row">
            <span>{{ t.name }} <TeamElo :value="t.average_elo" /></span>
            <select :value="teamGroupId[t.id] || ''" :disabled="assigningTeamId === t.id" @change="onAssignChange(t.id, $event)">
              <option value="">—</option>
              <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
          </div>
        </div>
        <p v-else class="text-muted">В турнире ещё нет команд.</p>
        <p v-if="assignError" class="delta-negative">{{ assignError }}</p>
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

.rename-row {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
  max-width: 480px;
}

.rename-row input {
  flex: 1;
}

.teams-assign {
  margin-top: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}

.assign-head,
.assign-row {
  display: grid;
  grid-template-columns: 1fr 200px;
  align-items: center;
  gap: 12px;
}

.assign-head {
  text-transform: uppercase;
  font-size: 11px;
  border-bottom: 1px solid var(--line);
}

@media (max-width: 560px) {
  .assign-head,
  .assign-row {
    grid-template-columns: 1fr 120px;
    gap: 8px;
  }
}
</style>
