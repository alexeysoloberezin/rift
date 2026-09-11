<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import apiClient from '../../api/client';
import { useAuthStore } from '../../stores/auth';

const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    const { data } = await apiClient.post('/auth/login', { email: email.value, password: password.value });
    auth.setSession(data.token, data.admin);
    router.push(route.query.redirect || '/admin');
  } catch (e) {
    error.value = e.response?.data?.error || 'Не удалось войти';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="container narrow">
    <h1>Вход для админа</h1>
    <form class="card form" @submit.prevent="submit">
      <label>
        Email
        <input v-model="email" type="email" required autocomplete="username" />
      </label>
      <label>
        Пароль
        <input v-model="password" type="password" required autocomplete="current-password" />
      </label>
      <p v-if="error" class="delta-negative">{{ error }}</p>
      <button class="btn btn-primary" type="submit" :disabled="loading">
        {{ loading ? 'Входим…' : 'Войти' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.narrow {
  max-width: 380px;
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
</style>
