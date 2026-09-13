<script setup>
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import api from '../../api/client';
const sessions = ref([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const copied = ref('');
const form = ref({ title: 'Пики карт', team_a: 'Команда A', team_b: 'Команда B', best_of: 1, first_team: 'A' });
const link = token => `${window.location.origin}/map-veto/${token}`;
async function load() {
  try { sessions.value = (await api.get('/map-veto')).data.data; }
  catch (err) { error.value = err.response?.data?.error || 'Не удалось загрузить сессии'; }
  finally { loading.value = false; }
}
async function create() {
  saving.value = true; error.value = '';
  try { sessions.value.unshift((await api.post('/map-veto', form.value)).data.data); }
  catch (err) { error.value = err.response?.data?.error || 'Не удалось создать сессию'; }
  finally { saving.value = false; }
}
async function copy(token) {
  try { await navigator.clipboard.writeText(link(token)); copied.value = token; }
  catch { error.value = 'Скопируйте ссылку из поля вручную'; }
}
onMounted(load);
</script>
<template>
  <main class="container veto-admin">
    <RouterLink to="/admin" class="text-muted">← Админ-панель</RouterLink>
    <h1>Пики карт</h1>
    <p class="text-muted">Отдельная сессия для двух команд. Создайте её и отправьте каждой команде свою ссылку.</p>
    <form class="card create-form" @submit.prevent="create">
      <label>Название сессии<input v-model="form.title" required maxlength="100" /></label>
      <label>Команда A<input v-model="form.team_a" required maxlength="100" /></label>
      <label>Команда B<input v-model="form.team_b" required maxlength="100" /></label>
      <label>Формат<select v-model.number="form.best_of"><option :value="1">BO1</option><option :value="3">BO3</option></select></label>
      <label>Первый ход<select v-model="form.first_team"><option value="A">{{ form.team_a }} (A)</option><option value="B">{{ form.team_b }} (B)</option></select></label>
      <p class="text-muted pool">Mirage · Inferno · Nuke · Ancient · Anubis · Dust II · Vertigo · Cache</p>
      <p class="text-muted pool">{{ form.best_of === 1 ? '7 банов по очереди; последняя карта — игровая.' : 'Бан → бан → пик → пик → бан → бан → бан. Последняя карта — решающая.' }}</p>
      <button class="btn btn-primary" :disabled="saving">{{ saving ? 'Создаём…' : 'Создать пики карт' }}</button>
    </form>
    <p v-if="error" role="alert" class="delta-negative">{{ error }}</p>
    <h2>Созданные сессии</h2>
    <button class="btn" @click="load">Обновить</button>
    <p v-if="loading" class="text-muted">Загрузка…</p>
    <p v-else-if="!sessions.length" class="text-muted">Сессий пока нет.</p>
    <article v-for="session in sessions" :key="session.id" class="card session">
      <h3>{{ session.title }} · BO{{ session.best_of }}</h3>
      <p>{{ session.team_a }} vs {{ session.team_b }} · {{ session.finished ? 'Завершено' : 'Ожидает ходов' }}</p>
      <div v-for="side in ['a', 'b']" :key="side" class="team-link">
        <label>Ссылка для {{ session['team_' + side] }} ({{ side.toUpperCase() }})<input readonly :value="link(session['token_' + side])" @focus="$event.target.select()" /></label>
        <button class="btn" @click="copy(session['token_' + side])">{{ copied === session['token_' + side] ? 'Скопировано' : 'Копировать' }}</button>
        <RouterLink class="btn" :to="'/map-veto/' + session['token_' + side]">Открыть</RouterLink>
      </div>
    </article>
  </main>
</template>
<style scoped>
.veto-admin { display: grid; gap: 18px; padding-bottom: 40px; }
.create-form { padding: 24px; display: grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap: 16px; }
label { display: grid; gap: 8px; min-width: 0; }
input, select { width: 100%; min-width: 0; }
.pool { grid-column: 1 / -1; }
.session { padding: 24px; display: grid; gap: 16px; }
.team-link { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; }
.team-link label { flex: 1; min-width: min(280px,100%); }
</style>
