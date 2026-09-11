<script setup>
import { computed } from 'vue';

const props = defineProps({
  nickname: { type: String, default: '?' },
  size: { type: Number, default: 28 },
  // 'a' / 'b' — красим кружок в цвет команды (для составов/статистики матча).
  // Без side — нейтральный акцент, вычисленный по нику (для общих списков).
  side: { type: String, default: null },
});

const initials = computed(() => {
  const clean = (props.nickname || '?').trim();
  return clean.slice(0, 2).toUpperCase();
});

// Небольшой хэш ника в оттенок — чтобы в общих списках игроков (без team
// side) кружки не были все одного цвета, но оставались в палитре клуба.
const hueTint = computed(() => {
  let hash = 0;
  for (const ch of props.nickname || '') hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
});
</script>

<template>
  <span
    class="player-avatar"
    :class="{ 'player-avatar--a': side === 'A', 'player-avatar--b': side === 'B' }"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.4)}px`,
      '--tint': !side ? `hsl(${hueTint} 40% 40%)` : null,
    }"
  >
    {{ initials }}
  </span>
</template>

<style scoped>
.player-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  border-radius: 50%;
  font-family: var(--font-display);
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--text);
  background: color-mix(in srgb, var(--tint, var(--red)) 55%, var(--bg-inset));
  border: 1px solid color-mix(in srgb, var(--tint, var(--red)) 70%, var(--line));
}

.player-avatar--a {
  background: color-mix(in srgb, var(--red) 55%, var(--bg-inset));
  border-color: color-mix(in srgb, var(--red) 75%, var(--line));
}

.player-avatar--b {
  background: color-mix(in srgb, var(--text-dim) 45%, var(--bg-inset));
  border-color: var(--line);
}
</style>
