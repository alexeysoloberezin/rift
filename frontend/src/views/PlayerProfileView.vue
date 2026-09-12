<script setup>
import TeamElo from '../components/TeamElo.vue';
import { computed, onMounted, ref } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import apiClient from '../api/client';
import RatingDelta from '../components/RatingDelta.vue';
import MapBadge from '../components/MapBadge.vue';
import PlayerAvatar from '../components/PlayerAvatar.vue';

const route = useRoute();
const player = ref(null);
const loading = ref(true);

onMounted(async () => {
  const { data } = await apiClient.get(`/players/${route.params.id}`);
  player.value = data.data;
  loading.value = false;
});

// Простой SVG-спарклайн истории рейтинга — без сторонних чарт-библиотек
const sparklinePoints = computed(() => {
  const history = player.value?.rating_history || [];
  if (history.length === 0) return '';
  const values = history.map((h) => Number(h.elo_after));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 600;
  const height = 120;
  const step = history.length > 1 ? width / (history.length - 1) : 0;

  return values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * (height - 16) - 8;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
});
</script>

<template>
  <div class="container" v-if="!loading && player">
    <div class="profile-head">
      <div class="profile-head__id">
        <PlayerAvatar :nickname="player.nickname" :size="64" />
        <div>
          <p class="text-muted mono eyebrow">Профиль игрока</p>
          <h1>{{ player.nickname }}</h1>
          <a v-if="player.faceit_link" :href="player.faceit_link" target="_blank" rel="noopener" class="text-muted faceit-link">
            FACEIT профиль →
          </a>
        </div>
      </div>
      <div class="rating-block">
        <div class="rating-value mono">{{ Number(player.rating).toFixed(0) }}</div>
        <div class="text-muted">рейтинг клуба · {{ player.matches_played }} матчей</div>
      </div>
    </div>

    <div class="card chart-card" v-if="player.rating_history.length > 1">
      <h2 class="block-title">Динамика рейтинга</h2>
      <svg viewBox="0 0 600 120" class="sparkline" preserveAspectRatio="none">
        <polyline :points="sparklinePoints" fill="none" stroke="var(--red)" stroke-width="2" />
      </svg>
    </div>

    <h2 class="block-title">История матчей</h2>
    <div class="card" v-if="player.match_stats.length">
      <RouterLink
        v-for="m in player.match_stats"
        :key="m.id"
        :to="`/matches/${m.match_id}`"
        class="scoreboard-row match-history-row"
      >
        <span>{{ m.team_a_name || '?' }} <TeamElo v-if="m.team_a_name" :value="m.team_a_average_elo" /> vs {{ m.team_b_name || '?' }} <TeamElo v-if="m.team_b_name" :value="m.team_b_average_elo" /></span>
        <MapBadge :map="m.map" size="sm" />
        <span class="mono">{{ m.kills }}-{{ m.deaths }}-{{ m.assists }}</span>
        <span class="mono">{{ Number(m.match_rating || 0).toFixed(2) }}</span>
        <RatingDelta :value="m.elo_change" />
      </RouterLink>
    </div>
    <p v-else class="text-muted">Игрок ещё не сыграл матчей с загруженной демкой.</p>
  </div>
  <p v-else-if="loading" class="container text-muted">Загрузка…</p>
</template>

<style scoped>
.profile-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 28px;
  flex-wrap: wrap;
  gap: 16px;
}

.profile-head__id {
  display: flex;
  align-items: center;
  gap: 18px;
}

.eyebrow {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}

.profile-head h1 {
  font-size: 40px;
}

.faceit-link {
  font-size: 13px;
}

.faceit-link:hover {
  color: var(--red-strong);
}

.rating-block {
  text-align: right;
}

.rating-value {
  font-size: 40px;
  color: var(--red-strong);
  font-weight: 700;
}

.chart-card {
  padding: 20px;
  margin-bottom: 32px;
}

.sparkline {
  width: 100%;
  height: 120px;
  display: block;
}

.block-title {
  font-size: 18px;
  margin-bottom: 12px;
}

.match-history-row {
  display: grid;
  grid-template-columns: 1.4fr 0.8fr 0.8fr 0.6fr 0.8fr;
  gap: 8px;
  align-items: center;
  font-size: 14px;
}

@media (max-width: 640px) {
  .profile-head h1 {
    font-size: 28px;
  }

  .rating-value {
    font-size: 28px;
  }

  .profile-head__id {
    gap: 12px;
  }

  /* 5 узких fr-колонок на телефоне сминали K/D/A и рейтинг матча в
     нечитаемую кашу — оставляем самое важное (соперник, карта, дельта),
     остальное доступно на странице самого матча по клику на строку. */
  .match-history-row {
    grid-template-columns: 1fr auto auto;
    font-size: 13px;
  }

  .match-history-row > :nth-child(3),
  .match-history-row > :nth-child(4) {
    display: none;
  }
}
</style>
