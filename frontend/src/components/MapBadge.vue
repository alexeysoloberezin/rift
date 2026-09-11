<script setup>
import { computed } from 'vue';
import { getMapMeta } from '../lib/maps';

const props = defineProps({
  map: { type: String, default: null },
  size: { type: String, default: 'sm' }, // 'sm' | 'md' | 'lg'
  showLabel: { type: Boolean, default: true },
});

const meta = computed(() => getMapMeta(props.map));
</script>

<template>
  <span class="map-badge" :class="`map-badge--${size}`">
    <span class="map-badge__icon" :style="{ '--map-color': meta.color }">
      <svg viewBox="0 0 32 32" class="map-badge__svg">
        <rect x="0.5" y="0.5" width="31" height="31" rx="7" class="map-badge__tile" />

        <template v-if="meta.glyph === 'sun'">
          <circle cx="16" cy="16" r="5.5" class="g-fill" />
          <g class="g-stroke">
            <line x1="16" y1="4" x2="16" y2="8" />
            <line x1="16" y1="24" x2="16" y2="28" />
            <line x1="4" y1="16" x2="8" y2="16" />
            <line x1="24" y1="16" x2="28" y2="16" />
            <line x1="7.5" y1="7.5" x2="10.3" y2="10.3" />
            <line x1="21.7" y1="21.7" x2="24.5" y2="24.5" />
            <line x1="24.5" y1="7.5" x2="21.7" y2="10.3" />
            <line x1="10.3" y1="21.7" x2="7.5" y2="24.5" />
          </g>
        </template>

        <template v-else-if="meta.glyph === 'arch'">
          <path d="M9 25 V17 A7 7 0 0 1 23 17 V25" class="g-stroke thick" />
          <line x1="6" y1="25" x2="26" y2="25" class="g-stroke thick" />
          <circle cx="16" cy="10" r="1.6" class="g-fill" />
        </template>

        <template v-else-if="meta.glyph === 'flame'">
          <path
            d="M16 6 C11 12 10 15 12 19 C10.5 18 9.5 16.5 9.5 14.5 C7 18 8 24 13 26 C17 27.5 22 25 22 20 C22 17 20 15.5 19 14 C19.5 16 18.5 17 17.5 17 C18.5 13 18 9 16 6 Z"
            class="g-fill"
          />
        </template>

        <template v-else-if="meta.glyph === 'radiation'">
          <circle cx="16" cy="16" r="2.6" class="g-fill" />
          <g class="g-fill">
            <path d="M16 16 L21 8 A10 10 0 0 1 25.5 16 Z" />
            <path d="M16 16 L11 8 A10 10 0 0 0 6.5 16 Z" />
            <path d="M16 16 L16 25.5 A10 10 0 0 0 21 22 Z" transform="rotate(180 16 16)" />
          </g>
        </template>

        <template v-else-if="meta.glyph === 'wave'">
          <path d="M5 13 Q 10 8, 16 13 T 27 13" class="g-stroke thick" />
          <path d="M5 20 Q 10 15, 16 20 T 27 20" class="g-stroke thick" />
        </template>

        <template v-else-if="meta.glyph === 'tower'">
          <rect x="12" y="6" width="8" height="20" rx="1" class="g-stroke thick" />
          <line x1="16" y1="6" x2="16" y2="2.5" class="g-stroke thick" />
          <line x1="12" y1="12" x2="20" y2="12" class="g-stroke" />
          <line x1="12" y1="17" x2="20" y2="17" class="g-stroke" />
          <line x1="12" y1="22" x2="20" y2="22" class="g-stroke" />
        </template>

        <template v-else-if="meta.glyph === 'temple'">
          <path d="M7 13 L16 6 L25 13 Z" class="g-fill" />
          <line x1="9" y1="14" x2="9" y2="25" class="g-stroke thick" />
          <line x1="16" y1="14" x2="16" y2="25" class="g-stroke thick" />
          <line x1="23" y1="14" x2="23" y2="25" class="g-stroke thick" />
          <line x1="6" y1="25" x2="26" y2="25" class="g-stroke thick" />
        </template>

        <template v-else-if="meta.glyph === 'pyramid'">
          <path d="M16 6 L26 25 H6 Z" class="g-stroke thick" />
          <line x1="16" y1="6" x2="16" y2="25" class="g-stroke" />
          <circle cx="22" cy="10" r="2" class="g-fill" />
        </template>

        <template v-else-if="meta.glyph === 'rail'">
          <line x1="6" y1="12" x2="26" y2="12" class="g-stroke thick" />
          <line x1="6" y1="21" x2="26" y2="21" class="g-stroke thick" />
          <line x1="9" y1="10" x2="9" y2="23" class="g-stroke" />
          <line x1="14" y1="10" x2="14" y2="23" class="g-stroke" />
          <line x1="19" y1="10" x2="19" y2="23" class="g-stroke" />
          <line x1="24" y1="10" x2="24" y2="23" class="g-stroke" />
        </template>

        <template v-else>
          <circle cx="16" cy="16" r="8" class="g-stroke thick" />
          <line x1="16" y1="4" x2="16" y2="10" class="g-stroke" />
          <line x1="16" y1="22" x2="16" y2="28" class="g-stroke" />
          <line x1="4" y1="16" x2="10" y2="16" class="g-stroke" />
          <line x1="22" y1="16" x2="28" y2="16" class="g-stroke" />
        </template>
      </svg>
    </span>
    <span v-if="showLabel" class="map-badge__label">{{ meta.label }}</span>
  </span>
</template>

<style scoped>
.map-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.map-badge__icon {
  display: inline-flex;
  flex: none;
  color: var(--map-color);
}

.map-badge__svg {
  width: 100%;
  height: 100%;
  display: block;
}

.map-badge__tile {
  fill: color-mix(in srgb, var(--map-color) 14%, var(--bg-inset));
  stroke: color-mix(in srgb, var(--map-color) 40%, var(--line));
}

.g-fill {
  fill: currentColor;
}

.g-stroke {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.g-stroke.thick {
  stroke-width: 2;
}

.map-badge__label {
  font-weight: 600;
  white-space: nowrap;
}

.map-badge--sm .map-badge__icon {
  width: 22px;
  height: 22px;
}

.map-badge--sm .map-badge__label {
  font-size: 13px;
}

.map-badge--md .map-badge__icon {
  width: 32px;
  height: 32px;
}

.map-badge--md .map-badge__label {
  font-size: 15px;
}

.map-badge--lg .map-badge__icon {
  width: 44px;
  height: 44px;
}

.map-badge--lg .map-badge__label {
  font-size: 18px;
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
</style>
