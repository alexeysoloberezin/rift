<script setup>
import { computed } from 'vue';

const props = defineProps({
  kills: { type: Array, default: () => [] },
  bounds: { type: Object, required: true }, // { minX, maxX, minY, maxY }
  sideBySteamId: { type: Object, default: () => ({}) }, // steam_id -> 'A' | 'B'
});

function normalize(x, y) {
  const spanX = Math.max(props.bounds.maxX - props.bounds.minX, 1);
  const spanY = Math.max(props.bounds.maxY - props.bounds.minY, 1);
  const nx = ((x - props.bounds.minX) / spanX) * 100;
  // Y инвертирован просто для привычной "вид сверху" ориентации — координатная
  // система демки к реальной карте никак не привязана (нет калибровочных
  // данных Valve), это чисто относительная схема.
  const ny = 100 - ((y - props.bounds.minY) / spanY) * 100;
  return [nx, ny];
}

const points = computed(() =>
  props.kills.map((k) => {
    const [ax, ay] = normalize(k.attacker_x, k.attacker_y);
    const [vx, vy] = normalize(k.victim_x, k.victim_y);
    const side = props.sideBySteamId[k.attacker_steam_id] || null;
    const weaponLabel = k.weapon ? ` (${k.weapon}${k.headshot ? ', HS' : ''})` : '';
    return {
      ax,
      ay,
      vx,
      vy,
      side,
      attackerLabel: `${k.attacker_nickname}${weaponLabel} → ${k.victim_nickname}`,
    };
  })
);
</script>

<template>
  <div class="kill-map">
    <svg viewBox="0 0 100 100" class="kill-map__svg" preserveAspectRatio="xMidYMid meet">
      <g class="kill-map__grid">
        <line v-for="i in 9" :key="`v${i}`" :x1="i * 10" y1="0" :x2="i * 10" y2="100" />
        <line v-for="i in 9" :key="`h${i}`" x1="0" :y1="i * 10" x2="100" :y2="i * 10" />
      </g>
      <g v-for="(p, idx) in points" :key="idx">
        <line
          :x1="p.ax"
          :y1="p.ay"
          :x2="p.vx"
          :y2="p.vy"
          class="kill-map__line"
          :class="p.side === 'A' ? 'kill-map__line--a' : 'kill-map__line--b'"
        />
        <circle
          :cx="p.ax"
          :cy="p.ay"
          r="1.6"
          class="kill-map__dot"
          :class="p.side === 'A' ? 'kill-map__dot--a' : 'kill-map__dot--b'"
        >
          <title>{{ p.attackerLabel }}</title>
        </circle>
        <g :transform="`translate(${p.vx}, ${p.vy})`" class="kill-map__x">
          <line x1="-1.5" y1="-1.5" x2="1.5" y2="1.5" />
          <line x1="-1.5" y1="1.5" x2="1.5" y2="-1.5" />
          <title>{{ p.attackerLabel }}</title>
        </g>
      </g>
    </svg>
    <p v-if="kills.length === 0" class="text-muted kill-map__empty">
      Для этого раунда не удалось получить позиции (см. предупреждения разбора демки выше).
    </p>
  </div>
</template>

<style scoped>
.kill-map {
  padding: 12px;
}

.kill-map__svg {
  width: 100%;
  aspect-ratio: 1 / 1;
  max-height: 420px;
  display: block;
  background: var(--bg-inset);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.kill-map__grid line {
  stroke: var(--line);
  stroke-width: 0.15;
}

.kill-map__line {
  stroke-width: 0.4;
  opacity: 0.7;
}

.kill-map__line--a {
  stroke: var(--red);
}

.kill-map__line--b {
  stroke: var(--text-dim);
}

.kill-map__dot--a {
  fill: var(--red-strong);
}

.kill-map__dot--b {
  fill: var(--text-muted);
}

.kill-map__x line {
  stroke: var(--red-strong);
  stroke-width: 0.6;
}

.kill-map__empty {
  text-align: center;
  padding: 20px;
  font-size: 13px;
}
</style>
