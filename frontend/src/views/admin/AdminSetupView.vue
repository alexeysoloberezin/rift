<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import apiClient from '../../api/client';
import { useAuthStore } from '../../stores/auth';

const router = useRouter();
const auth = useAuthStore();

const form = ref({ displayName: '', email: '', password: '', passwordConfirm: '' });
const error = ref('');
const success = ref(false);
const loading = ref(false);

async function submit() {
  error.value = '';

  if (form.value.password.length < 8) {
    error.value = 'Пароль должен быть не короче 8 символов';
    return;
  }
  if (form.value.password !== form.value.passwordConfirm) {
    error.value = 'Пароли не совпадают';
    return;
  }

  loading.value = true;
  try {
    // 1. Создаём первого админа (сработает только если в базе ещё нет ни одного)
    await apiClient.post('/auth/register-first-admin', {
      email: form.value.email,
      password: form.value.password,
      displayName: form.value.displayName || form.value.email,
    });

    // 2. Сразу логинимся этими же данными, чтобы не заставлять вводить их дважды
    const { data } = await apiClient.post('/auth/login', {
      email: form.value.email,
      password: form.value.password,
    });
    auth.setSession(data.token, data.admin);

    success.value = true;
    setTimeout(() => router.push('/admin'), 900);
  } catch (e) {
    error.value = e.response?.data?.error || 'Не удалось создать админа';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="container narrow">
    <p class="text-muted eyebrow mono">Первичная настройка</p>
    <h1>Создать админ-аккаунт</h1>
    <p class="text-muted hint">
      Форма работает только один раз — пока в базе нет ни одного админа. После создания
      первого аккаунта этот путь перестанет что-либо создавать, дальше вход только через
      <RouterLink to="/admin/login" class="inline-link">/admin/login</RouterLink>.
    </p>

    <form class="card form" @submit.prevent="submit">
      <label>
        Имя
        <input v-model="form.displayName" type="text" placeholder="Как вас показывать в админке" autocomplete="name" />
      </label>
      <label>
        Email
        <input v-model="form.email" type="email" required autocomplete="username" />
      </label>
      <label>
        Пароль
        <input v-model="form.password" type="password" required minlength="8" autocomplete="new-password" />
      </label>
      <label>
        Повторите пароль
        <input v-model="form.passwordConfirm" type="password" required minlength="8" autocomplete="new-password" />
      </label>

      <p v-if="error" class="delta-negative">{{ error }}</p>
      <p v-if="success" class="delta-positive">Готово, входим…</p>

      <button class="btn btn-primary" type="submit" :disabled="loading || success">
        {{ loading ? 'Создаём…' : 'Создать админа' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.narrow {
  max-width: 420px;
}

.eyebrow {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}

h1 {
  font-size: 28px;
  margin-bottom: 10px;
}

.hint {
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 20px;
}

.inline-link {
  color: var(--red-strong);
  text-decoration: underline;
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
