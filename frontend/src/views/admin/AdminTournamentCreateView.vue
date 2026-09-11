<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import apiClient from '../../api/client';

const form = ref({ name: '', description: '', format: '', start_date: '', end_date: '' });
const error = ref('');
const loading = ref(false);
const router = useRouter();

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    const { data } = await apiClient.post('/tournaments', form.value);
    router.push(`/admin/tournaments/${data.data.id}`);
  } catch (e) {
    error.value = e.response?.data?.error || 'Не удалось создать турнир';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="container narrow">
    <h1>Новый турнир</h1>
    <form class="card form" @submit.prevent="submit">
      <label>
        Название
        <input v-model="form.name" type="text" required placeholder="RIFT Cup #1" />
      </label>
      <label>
        Описание
        <textarea v-model="form.description" rows="3" placeholder="Краткое описание турнира" />
      </label>
      <label>
        Формат
        <input v-model="form.format" type="text" placeholder="Группы + плей-офф, BO1/BO3" />
      </label>
      <div class="row-2">
        <label>
          Начало
          <input v-model="form.start_date" type="date" />
        </label>
        <label>
          Окончание
          <input v-model="form.end_date" type="date" />
        </label>
      </div>
      <p v-if="error" class="delta-negative">{{ error }}</p>
      <button class="btn btn-primary" type="submit" :disabled="loading">
        {{ loading ? 'Создаём…' : 'Создать турнир' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.narrow {
  max-width: 480px;
}

h1 {
  font-size: 28px;
  margin-bottom: 20px;
}

.form {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-muted);
}

.row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
</style>
