<script setup>
import { computed } from 'vue';
import PlayerAvatar from './PlayerAvatar.vue';

// Переиспользуемая доска драфта — блоки команд + пул доступных игроков.
// Используется и на публичной странице турнира (canPick всегда false —
// зрительский режим), и на капитанской странице по токену (canPick true,
// когда сейчас ход этого капитана).
const props = defineProps({
  data: { type: Object, required: true }, // результат GET .../draft (не null)
  canPick: { type: Boolean, default: false },
  picking: { type: Boolean, default: false },
});

const emit = defineEmits(['pick']);

const isFinished = computed(() => props.data.status === 'finished');
</script>

<template>
  <div class="draft-board">
    <div class="draft-status card">
      <template v-if="isFinished">
        <strong>Драфт завершён</strong>
        <span class="text-muted">Все зарегистрированные игроки распределены по командам.</span>
      </template>
      <template v-else>
        <strong>Раунд {{ data.round }} · Пик №{{ data.pick_number }}</strong>
        <span class="text-muted">
          На часах:
          <span class="on-the-clock">{{ data.teams.find((t) => t.team_id === data.current_team_id)?.team_name }}</span>
        </span>
      </template>
    </div>

    <div class="teams-grid">
      <div
        v-for="team in data.teams"
        :key="team.team_id"
        class="card team-block"
        :class="{ 'team-block--active': team.is_on_the_clock }"
      >
        <div class="team-block__head">
          <PlayerAvatar :nickname="team.captain_nickname" :size="28" />
          <div>
            <div class="team-block__name">{{ team.team_name }}</div>
            <div class="team-block__captain text-muted">Капитан: {{ team.captain_nickname }}</div>
          </div>
          <span v-if="team.is_on_the_clock" class="clock-dot" title="Сейчас пикает"></span>
        </div>
        <ul class="team-block__roster">
          <li v-for="p in team.picks" :key="p.player_id" class="avatar-row">
            <PlayerAvatar :nickname="p.nickname" :size="20" />
            {{ p.nickname }}
          </li>
          <li v-if="team.picks.length === 0" class="text-muted roster-empty">Пока никого не выбрал</li>
        </ul>
      </div>
    </div>

    <div class="card pool-block">
      <h3 class="pool-title">
        Доступные игроки ({{ data.available_players.length }})
      </h3>
      <div class="pool-table" v-if="data.available_players.length">
        <div
          v-for="p in data.available_players"
          :key="p.id"
          class="scoreboard-row pool-row"
          :class="{ 'pool-row--pickable': canPick }"
          @click="canPick && !picking ? emit('pick', p.id) : null"
        >
          <PlayerAvatar :nickname="p.nickname" :size="24" />
          <span>{{ p.nickname }}</span>
          <span class="mono text-muted">{{ p.seed_rating != null ? Number(p.seed_rating).toFixed(0) : '—' }}</span>
          <button v-if="canPick" class="btn btn-primary pick-btn" type="button" :disabled="picking">
            {{ picking ? '…' : 'Выбрать' }}
          </button>
        </div>
      </div>
      <p v-else class="text-muted" style="padding: 12px 0">Свободных игроков не осталось.</p>
    </div>
  </div>
</template>

<style scoped>
.draft-board {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.draft-status {
  padding: 14px 18px;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.on-the-clock {
  color: var(--gold);
  font-weight: 700;
}

.teams-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}

.team-block {
  padding: 14px;
  border: 1px solid var(--line);
  transition: border-color 0.15s, background 0.15s;
}

.team-block--active {
  border-color: var(--gold);
  background: color-mix(in srgb, var(--gold) 6%, transparent);
}

.team-block__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.team-block__name {
  font-weight: 700;
  font-size: 14px;
}

.team-block__captain {
  font-size: 11px;
}

.clock-dot {
  margin-left: auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--gold);
  flex: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--gold) 25%, transparent);
}

.team-block__roster {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.roster-empty {
  font-size: 12px;
}

.pool-block {
  padding: 18px;
}

.pool-title {
  font-size: 16px;
  margin-bottom: 10px;
}

.pool-table {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}

.pool-row {
  grid-template-columns: 24px 1fr 70px auto;
  gap: 10px;
  border-bottom: 1px solid var(--line);
}

.pool-table > *:last-child {
  border-bottom: none;
}

.pool-row--pickable {
  cursor: pointer;
}

.pool-row--pickable:hover {
  background: var(--bg-inset);
}

.pick-btn {
  padding: 4px 12px;
  font-size: 12px;
}
</style>
