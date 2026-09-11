<script setup>
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import apiClient from '../api/client';
import StatusBadge from '../components/StatusBadge.vue';

const tournaments = ref([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const { data } = await apiClient.get('/tournaments');
    tournaments.value = data.data.slice(0, 4);
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="hero container">
    <img src="/logo.png" alt="" aria-hidden="true" class="hero__watermark" />
    <p class="hero__eyebrow">PC-клуб RIFT</p>
    <h1 class="hero__title">Турниры по CS2.<br />Своя лига, свой рейтинг.</h1>
    <p class="hero__lead">
      Составы, матчи и демки — всё в одном месте. После каждой загруженной демки клуб
      пересчитывает рейтинг игроков по собственной методике, вдохновлённой FACEIT: перфоманс за матч
      плюс изменение общего эло с учётом силы соперника.
    </p>
    <div class="hero__actions">
      <RouterLink to="/tournaments" class="btn btn-primary">Смотреть турниры</RouterLink>
      <RouterLink to="/players" class="btn">Рейтинг игроков</RouterLink>
    </div>
  </section>

  <section class="container">
    <div class="section-head">
      <h2>Последние турниры</h2>
      <RouterLink to="/tournaments" class="text-muted">Все турниры →</RouterLink>
    </div>

    <p v-if="loading" class="text-muted">Загрузка…</p>
    <p v-else-if="tournaments.length === 0" class="text-muted">Турниров пока нет — загляните позже.</p>

    <div v-else class="card">
      <RouterLink
        v-for="t in tournaments"
        :key="t.id"
        :to="`/tournaments/${t.id}`"
        class="scoreboard-row tournament-row"
      >
        <div>
          <div class="tournament-row__name">{{ t.name }}</div>
          <div class="text-muted tournament-row__meta">
            {{ t.players_count }} игроков · {{ t.matches_count }} матчей
          </div>
        </div>
        <StatusBadge :status="t.status" />
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.hero {
  padding: 48px 0 56px;
  max-width: 780px;
  position: relative;
}

.hero > * {
  position: relative;
  z-index: 1;
}

.hero__watermark {
  position: absolute;
  top: -40px;
  right: -40px;
  width: 320px;
  height: 320px;
  object-fit: contain;
  opacity: 0.16;
  mask-image: radial-gradient(circle, #000 40%, transparent 72%);
  -webkit-mask-image: radial-gradient(circle, #000 40%, transparent 72%);
  pointer-events: none;
  z-index: 0;
}

.hero__eyebrow {
  color: var(--red-strong);
  font-family: var(--font-mono);
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin: 0 0 16px;
}

.hero__title {
  font-size: 56px;
  line-height: 1.02;
  margin-bottom: 20px;
}

.hero__lead {
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1.6;
  max-width: 620px;
  margin-bottom: 28px;
}

.hero__actions {
  display: flex;
  gap: 12px;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 16px;
}

.section-head h2 {
  font-size: 22px;
}

.tournament-row {
  grid-template-columns: 1fr auto;
}

.tournament-row__name {
  font-weight: 600;
  font-size: 16px;
}

.tournament-row__meta {
  font-size: 13px;
  margin-top: 2px;
}

@media (max-width: 640px) {
  .hero {
    padding: 32px 0 40px;
  }

  /* На узком экране огромный заголовок (56px) в паре с watermark-лого
     съезжались друг на друга — самый заметный "слом" на мобильном. */
  .hero__title {
    font-size: 34px;
  }

  .hero__lead {
    font-size: 15px;
  }

  .hero__watermark {
    width: 160px;
    height: 160px;
    top: -20px;
    right: -30px;
    opacity: 0.1;
  }

  .hero__actions {
    flex-wrap: wrap;
  }

  .hero__actions .btn {
    flex: 1 1 auto;
    justify-content: center;
  }
}
</style>
