<script setup>
import { computed } from 'vue';

// Цветной квадрат с числом уровня FACEIT (1-10) — тот же принцип, что и
// у самого FACEIT: чем выше уровень, тем "горячее" цвет. Палитра — из
// существующих токенов темы клуба (без привязки к цветам самого FACEIT),
// чтобы бейдж не выглядел чужеродной вставкой на странице.
const props = defineProps({
  level: { type: Number, default: null },
});

const tint = computed(() => {
  const l = props.level;
  if (l >= 9) return 'var(--red-strong)';
  if (l >= 7) return 'color-mix(in srgb, var(--gold) 40%, var(--red-strong))';
  if (l >= 4) return 'var(--gold)';
  return 'var(--text-dim)';
});
</script>

<template>
  <span v-if="level" class="faceit-level" :style="{ '--tint': tint }" :title="`Уровень FACEIT ${level}`">
    {{ level }}
  </span>
</template>

<style scoped>
.faceit-level {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  color: #0d0d10;
  background: var(--tint);
}
</style>
