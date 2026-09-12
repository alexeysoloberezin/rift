<script setup>
defineProps({ value: { type: [Number, String], default: null } });
</script>

<template>
  <small class="team-elo" title="Среднее известное FACEIT Elo текущего состава команды, включая капитана">
    Среднее Elo {{ value == null ? '—' : Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) }}
  </small>
</template>

<style scoped>
.team-elo { display: inline-block; color: var(--gold); font-size: 14px; font-weight: 600; white-space: nowrap; margin-left: 6px; }
</style>
