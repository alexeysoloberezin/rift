<script setup>
defineProps({
  status: { type: String, required: true },
});

const LABELS = {
  draft: 'Черновик',
  registration: 'Регистрация',
  active: 'Идёт',
  finished: 'Завершён',
  scheduled: 'Запланирован',
  played: 'Сыгран',
  needs_demo: 'Нужна демка',
  parsing_demo: 'Обработка демки',
  rated: 'Рейтинг посчитан',
  pending: 'В очереди',
  parsing: 'Парсится',
  parsed: 'Обработана',
  error: 'Ошибка',
};
</script>

<template>
  <span class="badge" :class="{ 'badge--live': status === 'active' || status === 'parsing_demo' || status === 'parsing' }">
    <span class="badge-dot" />
    {{ LABELS[status] || status }}
  </span>
</template>
