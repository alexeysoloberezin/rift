<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api/client';
import MapBadge from '../components/MapBadge.vue';
import { getMapMeta } from '../lib/maps';
const route = useRoute();
const board = ref(null);
const error = ref('');
const busy = ref(false);
const selected = ref(null);
let timer;
let stopped = false;
const myTurn = computed(() => board.value && !board.value.finished && board.value.next_team === board.value.own_team);
const teamName = side => `${side === 'A' ? board.value.team_a : board.value.team_b} (${side})`;
const actionFor = map => board.value.actions.find(action => action.map === map);
async function refresh() {
  if (busy.value) return;
  try {
    const data = (await api.get('/map-veto/team/' + route.params.token)).data.data;
    if (busy.value || (board.value && data.actions.length < board.value.actions.length)) return;
    if (board.value?.actions.length !== data.actions.length) selected.value = null;
    board.value = data; error.value = '';
  } catch (err) { error.value = err.response?.data?.error || 'Нет связи. Повторяем подключение…'; }
}
async function poll() { await refresh(); if (!stopped) timer = setTimeout(poll, 2500); }
async function submit() {
  if (!myTurn.value || !selected.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    board.value = (await api.post('/map-veto/team/' + route.params.token, { map: selected.value, expected_turn: board.value.actions.length })).data.data;
    selected.value = null;
  } catch (err) { error.value = err.response?.data?.error || 'Не удалось сохранить ход'; }
  finally { busy.value = false; }
}
onMounted(poll);
onUnmounted(() => { stopped = true; clearTimeout(timer); });
</script>
<template>
  <main class="container veto-page">
    <p v-if="error" role="alert" class="delta-negative">{{ error }}</p>
    <template v-if="board">
      <header><p class="text-muted">ПИКИ КАРТ · BO{{ board.best_of }}</p><h1>{{ board.title }}</h1><p>{{ board.team_a }} vs {{ board.team_b }}</p></header>
      <section class="card turn" aria-live="polite">
        <p>Вы — {{ teamName(board.own_team) }}</p>
        <h2 v-if="board.finished">Пики завершены</h2>
        <h2 v-else>{{ myTurn ? 'Ваш ход' : 'Ход ' + teamName(board.next_team) }}: {{ board.next_action === 'ban' ? 'бан карты' : 'пик карты' }}</h2>
        <p class="text-muted">{{ board.best_of === 1 ? 'Баны по очереди до последней карты.' : 'Бан → бан → пик → пик → бан → бан → бан → решающая карта.' }}</p>
      </section>
      <div class="maps">
        <button v-for="map in board.maps" :key="map" class="card map" :class="{ selected: selected === map, banned: actionFor(map)?.type === 'ban', picked: actionFor(map)?.type === 'pick' }" :disabled="!myTurn || busy || !board.available.includes(map)" :aria-pressed="selected === map" @click="selected = map">
          <MapBadge :map="map" size="lg" />
          <span v-if="actionFor(map)">{{ actionFor(map).type === 'ban' ? 'Бан' : 'Пик' }} · {{ teamName(actionFor(map).team) }}</span>
          <span v-else>{{ board.finished ? 'Решающая карта' : 'Доступна' }}</span>
        </button>
      </div>
      <button v-if="myTurn" class="btn btn-primary confirm" :disabled="!selected || busy" @click="submit">{{ busy ? 'Сохраняем…' : (board.next_action === 'ban' ? 'Забанить' : 'Выбрать') + (selected ? ' ' + getMapMeta(selected).label : ' карту') }}</button>
      <section v-if="board.result.length" class="card result"><h2>{{ board.finished ? 'Карты серии' : 'Выбранные карты' }}</h2><ol><li v-for="map in board.result" :key="map">{{ getMapMeta(map).label }}{{ board.finished && map === board.available[0] && board.best_of > 1 ? ' — решающая' : '' }}</li></ol></section>
      <section v-if="board.actions.length"><h2>История ходов</h2><ol><li v-for="(action, index) in board.actions" :key="index">{{ teamName(action.team) }} · {{ action.type === 'ban' ? 'бан' : 'пик' }} {{ getMapMeta(action.map).label }}</li></ol></section>
    </template>
    <p v-else-if="!error" class="text-muted">Загрузка сессии…</p>
  </main>
</template>
<style scoped>
.veto-page { display: grid; gap: 24px; padding-bottom: 48px; }
header { text-align: center; display: grid; gap: 10px; }
.turn, .result { padding: 24px; display: grid; gap: 12px; }
.maps { display: grid; grid-template-columns: repeat(auto-fit,minmax(200px,1fr)); gap: 16px; }
.map { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; min-height: 170px; padding: 20px; color: var(--text); cursor: pointer; border: 2px solid var(--line); }
.map:disabled { cursor: default; }
.map.selected { border-color: var(--red-strong); }
.map.banned { opacity: .45; }
.map.picked { border-color: var(--gold); }
.map span { overflow-wrap: anywhere; }
.confirm { justify-self: center; min-height: 48px; }
ol { padding-left: 24px; line-height: 1.9; }
</style>
