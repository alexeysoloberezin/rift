<script setup>
const props = defineProps({
  value: { type: [Number, String], default: 0 },
});

function num(v) {
  return Number(v || 0);
}
</script>

<template>
  <span class="mono" :class="num(value) > 0 ? 'delta-positive' : num(value) < 0 ? 'delta-negative' : 'text-muted'">
    {{ num(value) > 0 ? '▲' : num(value) < 0 ? '▼' : '·' }}
    {{ num(value) > 0 ? '+' : '' }}{{ num(value).toFixed(1) }}
  </span>
</template>
