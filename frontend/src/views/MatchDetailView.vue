<script setup>
import TeamElo from '../components/TeamElo.vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import apiClient from '../api/client';
import StatusBadge from '../components/StatusBadge.vue';
import RatingDelta from '../components/RatingDelta.vue';
import MapBadge from '../components/MapBadge.vue';
import PlayerAvatar from '../components/PlayerAvatar.vue';

const route = useRoute();
const match = ref(null);
const loading = ref(true);
const screenshotUrl = computed(() => match.value?.screenshot_version ? apiClient.defaults.baseURL.replace(/\/$/, '') + '/matches/' + match.value.id + '/screenshot?v=' + encodeURIComponent(match.value.screenshot_version) : null);
const demoDownloadUrl = (demo) => apiClient.defaults.baseURL.replace(/\/$/, '') + '/demos/' + demo.id + '/download';
let pollTimer = null;

async function load() {
  const { data } = await apiClient.get(`/matches/${route.params.id}`);
  match.value = data.data;
  loading.value = false;

  // Пока хоть одна демка ещё обрабатывается — обновляем страницу сами,
  // чтобы статус (успех/ошибка) и статистика появились без ручного reload.
  const isProcessing = (match.value.demos || []).some((d) => d.status === 'pending' || d.status === 'parsing');
  clearTimeout(pollTimer);
  if (isProcessing) {
    pollTimer = setTimeout(load, 4000);
  }
}

onMounted(load);
onUnmounted(() => clearTimeout(pollTimer));

const teamAStats = computed(() => (match.value?.stats || []).filter((s) => s.team_id === match.value.team_a_id));
const teamBStats = computed(() => (match.value?.stats || []).filter((s) => s.team_id === match.value.team_b_id));

// Самая свежая обработанная демка с сохранённым разбором (raw_stats) — там
// лежат детали, которых нет в самой таблице matches: тикрейт, длительность,
// сервер, подробный лог по раундам (см. demo-parser/app/parser.py). Демки
// в match.demos уже отсортированы бэкендом по uploaded_at DESC.
const parsedDemo = computed(() => (match.value?.demos || []).find((d) => d.raw_stats)?.raw_stats || null);
const rounds = computed(() => parsedDemo.value?.rounds || []);
const sideStats = computed(() => parsedDemo.value?.side_stats || null);
const economySummary = computed(() => parsedDemo.value?.economy_summary || null);
const parseWarnings = computed(() => parsedDemo.value?.parse_warnings || []);

// "Бонусные" статы по игроку (оружие/утилита/гранаты/дистанция) лежат в
// parsedDemo.players[] и идентифицированы по steam_id — а не в самой строке
// match_player_stats (там только базовый набор колонок). Собираем карту
// steam_id -> расширенные статы, чтобы дополнить таблицу составов.
const playerExtraBySteamId = computed(() => {
  const map = new Map();
  for (const p of parsedDemo.value?.players || []) {
    if (p.steam_id) map.set(p.steam_id, p);
  }
  return map;
});

function extraFor(stat) {
  return (stat.steam_id64 ? playerExtraBySteamId.value.get(stat.steam_id64) : null)
    || parsedDemo.value?.players?.find(p => p.nickname.toLowerCase() === stat.nickname.toLowerCase()) || null;
}

function topWeapon(extra) {
  const byWeapon = extra?.kills_by_weapon;
  if (!byWeapon || Object.keys(byWeapon).length === 0) return null;
  const [weapon, count] = Object.entries(byWeapon).sort((a, b) => b[1] - a[1])[0];
  return `${weapon} ×${count}`;
}

const BUY_LABELS = { eco: 'Эко', force: 'Форс', full: 'Фулбай' };
function buyTypeLabel(type) {
  return BUY_LABELS[type] || '—';
}

function formatDuration(sec) {
  if (sec == null) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function teamNameForSide(side) {
  if (side === 'A') return match.value?.team_a_name || 'Команда A';
  if (side === 'B') return match.value?.team_b_name || 'Команда B';
  return '—';
}
</script>

<template>
  <div class="container match-detail-container" v-if="!loading && match">
    <div class="scoreboard-head">
      <div class="match-map">
        <MapBadge :map="match.map" size="lg" />
      </div>
      <div class="teams-line">
        <h1>{{ match.team_a_name || 'Команда A' }} <TeamElo v-if="match.team_a_name" :value="match.team_a_average_elo" /></h1>
        <div class="score-block mono">
          <span>{{ match.score_a ?? '–' }}</span>
          <span class="score-sep">:</span>
          <span>{{ match.score_b ?? '–' }}</span>
        </div>
        <h1>{{ match.team_b_name || 'Команда B' }} <TeamElo v-if="match.team_b_name" :value="match.team_b_average_elo" /></h1>
      </div>
      <div class="meta-line text-muted mono">
        <span>BO{{ match.best_of }}</span>
        <template v-if="parsedDemo">
          <span>·</span>
          <span>{{ parsedDemo.rounds_total }} раундов</span>
          <span v-if="parsedDemo.duration_sec != null">·</span>
          <span v-if="parsedDemo.duration_sec != null">{{ formatDuration(parsedDemo.duration_sec) }}</span>
          <span v-if="parsedDemo.tick_rate">·</span>
          <span v-if="parsedDemo.tick_rate">tick {{ parsedDemo.tick_rate }}</span>
        </template>
        <span>·</span>
        <StatusBadge :status="match.status" />
      </div>
      <p v-if="parsedDemo?.server_name" class="text-muted server-name">{{ parsedDemo.server_name }}</p>
    </div>

    <div v-if="match.demos?.length" class="demo-downloads">
      <a v-for="demo in match.demos" :key="demo.id" :href="demoDownloadUrl(demo)" class="btn demo-download-btn" download>
        <span aria-hidden="true">↓</span> Скачать {{ demo.original_name || 'демо' }}
      </a>
    </div>

    <div v-if="parseWarnings.length" class="card parse-warnings">
      <p class="text-muted">
        Часть дополнительной статистики не посчиталась для этой демки (не критично — базовые статы и счёт не
        затронуты):
      </p>
      <ul class="text-muted parse-warnings__list">
        <li v-for="(w, i) in parseWarnings" :key="i">{{ w }}</li>
      </ul>
    </div>

    <div v-if="sideStats || economySummary" class="summary-blocks">
      <div v-if="sideStats" class="card summary-card">
        <h2 class="block-title">Стороны</h2>
        <div class="side-summary">
          <div v-for="(key, idx) in ['team_a', 'team_b']" :key="key" class="side-summary__team">
            <p class="text-muted side-summary__name">{{ teamNameForSide(idx === 0 ? 'A' : 'B') }}</p>
            <div class="side-summary__row" v-for="side in ['T', 'CT']" :key="side">
              <span class="mono">{{ side }}</span>
              <span class="text-muted mono">
                {{ sideStats[key][side].wins }}/{{ sideStats[key][side].rounds }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="economySummary" class="card summary-card">
        <h2 class="block-title">Закупки</h2>
        <div class="side-summary">
          <div v-for="(key, idx) in ['team_a', 'team_b']" :key="key" class="side-summary__team">
            <p class="text-muted side-summary__name">{{ teamNameForSide(idx === 0 ? 'A' : 'B') }}</p>
            <div class="side-summary__row" v-for="buy in ['full', 'force', 'eco']" :key="buy">
              <span>{{ buyTypeLabel(buy) }}</span>
              <span class="text-muted mono">
                {{ economySummary[key][buy].wins }}/{{ economySummary[key][buy].rounds }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <p v-if="!screenshotUrl && parsedDemo?.source === 'csv'" class="text-muted">Статистика из CSV. Неизвестные показатели отмечены прочерком. ADR и рейтинг скрина показываются только при наличии в CSV; рейтинг RIFT не рассчитывается, Elo не изменяется. Карта и счёт задаются организатором отдельно.</p>
    <a v-if="screenshotUrl" :href="screenshotUrl" target="_blank" rel="noopener" class="stats-screenshot" aria-label="Открыть скриншот статистики в полном размере">
      <img :src="screenshotUrl" alt="Статистика матча" />
    </a>
    <div v-else class="stat-tables">
      <div v-for="(teamStats, idx) in [teamAStats, teamBStats]" :key="idx" class="card stat-table">
        <div class="stat-table-scroll">
          <div class="stat-table__head mono text-muted">
            <span>Игрок</span>
            <span>K-D-A</span>
            <span>ADR</span>
            <span>KAST</span>
            <span>{{ parsedDemo?.csv_format === 'screenshot' ? 'Рейтинг скрина' : 'Рейтинг' }}</span>
            <span>Эло</span>
            <span>Утил. дмг</span>
            <span>Топ оружие</span>
          </div>
          <RouterLink
            v-for="s in teamStats"
            :key="s.id"
            :to="`/players/${s.player_id}`"
            class="scoreboard-row stat-row"
          >
            <span class="stat-row__name avatar-row">
              <PlayerAvatar :nickname="s.nickname" :side="idx === 0 ? 'A' : 'B'" :size="24" />
              {{ s.nickname }}
            </span>
            <span class="mono">{{ s.kills }}-{{ s.deaths }}-{{ s.assists }}</span>
            <span class="mono">{{ s.adr == null ? '—' : Number(s.adr).toFixed(0) }}</span>
            <span class="mono">{{ s.kast_pct == null ? '—' : Number(s.kast_pct).toFixed(0) + '%' }}</span>
            <span class="mono">{{ parsedDemo?.csv_format === 'screenshot' ? (extraFor(s)?.source_rating == null ? '—' : Number(extraFor(s).source_rating).toFixed(2)) : (s.match_rating == null ? '—' : Number(s.match_rating).toFixed(2)) }}</span>
            <RatingDelta v-if="s.elo_change != null" :value="s.elo_change" /><span v-else class="text-muted">—</span>
            <span class="mono text-muted">{{ extraFor(s)?.utility_damage ?? '—' }}</span>
            <span class="text-muted">{{ topWeapon(extraFor(s)) || '—' }}</span>
          </RouterLink>
        </div>
        <p v-if="teamStats.length === 0" class="text-muted" style="padding: 16px">
          Статистика появится после загрузки и разбора демки.
        </p>
      </div>
    </div>

    <div v-if="rounds.length" class="rounds-block">
      <h2 class="block-title">Раунды</h2>
      <div class="card rounds-scroll">
        <div class="rounds-table">
          <div class="rounds-head mono text-muted">
            <span>#</span>
            <span>Победитель</span>
            <span>Причина</span>
            <span>Счёт</span>
            <span>Время</span>
            <span>Топ фраг</span>
            <span>Вход</span>
            <span>Закупка A/B</span>
            <span>Клатч</span>
          </div>
          <template v-for="r in rounds" :key="r.round">
            <div class="scoreboard-row rounds-row">
              <span class="mono">{{ r.round }}</span>
              <span :class="r.winner === 'A' ? 'rounds-row__winner-a' : 'rounds-row__winner-b'">
                {{ teamNameForSide(r.winner) }}
              </span>
              <span class="text-muted">{{ r.reason || '—' }}</span>
              <span class="mono">{{ r.score_a_after }}:{{ r.score_b_after }}</span>
              <span class="mono text-muted">{{ r.duration_sec != null ? formatDuration(r.duration_sec) : '—' }}</span>
              <span class="text-muted">
                {{ r.top_killer ? `${r.top_killer} (${r.top_killer_kills})` : '—' }}
              </span>
              <span class="text-muted">
                {{ r.entry_kill_by ? `${r.entry_kill_by} → ${r.entry_death_of || '?'}` : '—' }}
              </span>
              <span class="mono text-muted">
                {{ buyTypeLabel(r.team_a_buy_type) }} / {{ buyTypeLabel(r.team_b_buy_type) }}
              </span>
              <span :class="r.clutch ? (r.clutch.won ? 'delta-positive' : 'delta-negative') : 'text-muted'">
                {{ r.clutch ? `${r.clutch.player} 1v${r.clutch.opponents} ${r.clutch.won ? '✓' : '✗'}` : '—' }}
              </span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div v-if="match.demos.length" class="demos-block">
      <h2 class="block-title">Демки</h2>
      <div class="card">
        <div v-for="d in match.demos" :key="d.id">
          <div class="scoreboard-row demo-row">
            <span>{{ d.original_name }}</span>
            <StatusBadge :status="d.status" />
          </div>
          <div v-if="d.status === 'error'" class="demo-error">
            <strong class="delta-negative">Демка не обработана.</strong>
            <span class="text-muted">{{ d.error_message || 'Причина не сохранена.' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
  <p v-else-if="loading" class="container text-muted">Загрузка…</p>
</template>

<style scoped>
.demo-downloads { display: flex; justify-content: center; flex-wrap: wrap; gap: 10px; margin: -12px 0 28px; }
.demo-download-btn { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stats-screenshot { display: block; width: 100%; margin: 24px 0; }
.stats-screenshot img { display: block; width: 100%; height: auto; border-radius: var(--radius); }
/* Эта страница даёт таблице составов и раундов больше воздуха, чем обычный
   .container (1160px) — со всеми новыми колонками (оружие/утилита/закупка/
   клатч) им реально нужно больше ширины на нормальном мониторе клуба.
   Через две колонки-классы specificity выше глобального .container из
   theme.css, так что переопределяет его независимо от порядка подключения
   стилей — а на другие страницы это не влияет. */
.match-detail-container {
  max-width: 1520px;
}

.scoreboard-head {
  text-align: center;
  padding: 24px 0 40px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 32px;
  position: relative;
}

.match-map {
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
}

.teams-line {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 24px;
}

.teams-line h1 {
  font-size: 32px;
}

.teams-line h1:first-child {
  text-align: right;
}

.teams-line h1:last-child {
  text-align: left;
}

.score-block {
  font-size: 44px;
  font-weight: 700;
  color: var(--red-strong);
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.score-sep {
  color: var(--text-dim);
}

.meta-line {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 10px;
  align-items: center;
  font-size: 13px;
}

.parse-warnings {
  padding: 14px 20px;
  margin-bottom: 24px;
  font-size: 13px;
}

.parse-warnings__list {
  margin: 6px 0 0;
  padding-left: 18px;
}

.summary-blocks {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 24px;
}

.summary-card {
  padding: 18px 20px;
  min-width: 0; /* тот же grid-blowout риск, что и у .stat-table — см. её комментарий */
}

.side-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.side-summary__name {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}

.side-summary__row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 4px 0;
}

.stat-tables {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.stat-table {
  /* Grid-итем по умолчанию min-width:auto — не может стать уже, чем самый
     широкий потомок (тут это .stat-row с min-width:640px), из-за чего карта
     распирала свою колонку 1fr и вылезала за пределы страницы. min-width:0
     возвращает карте её честную долю 1fr, а прокрутка ниже (.stat-table-scroll)
     уже сама решает, что делать с переполнением внутри неё. */
  min-width: 0;
}

.stat-table-scroll {
  overflow-x: auto;
}

.stat-table__head,
.stat-row {
  display: grid;
  grid-template-columns: 1.6fr 1fr 0.7fr 0.7fr 0.8fr 0.9fr 0.9fr 1.1fr;
  gap: 8px;
  font-size: 13px;
  align-items: center;
  min-width: 640px;
}

.stat-table__head {
  padding: 10px 16px 10px 20px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 11px;
  border-bottom: 1px solid var(--line);
}

.stat-row__name {
  font-weight: 600;
}

.block-title {
  font-size: 18px;
  margin-bottom: 12px;
}

.server-name {
  margin-top: 6px;
  font-size: 11px;
}

.rounds-block {
  margin-top: 32px;
}

.rounds-scroll {
  overflow-x: auto;
}

.rounds-table {
  min-width: 980px;
}

.rounds-head,
.rounds-row {
  display: grid;
  grid-template-columns: 0.4fr 1fr 1.3fr 0.6fr 0.6fr 1.1fr 1.2fr 1fr 1.2fr;
  gap: 8px;
  font-size: 13px;
  align-items: center;
}

.rounds-head {
  padding: 10px 16px 10px 20px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 11px;
  border-bottom: 1px solid var(--line);
}

.rounds-row__winner-a {
  font-weight: 600;
  color: var(--red-strong);
}

.rounds-row__winner-b {
  font-weight: 600;
}

.demos-block {
  margin-top: 32px;
}

.demo-row {
  grid-template-columns: 1fr auto;
}

.demo-error {
  padding: 0 16px 14px 20px;
  margin-top: -6px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

@media (max-width: 860px) {
  .stat-tables {
    grid-template-columns: 1fr;
  }
  .summary-blocks {
    grid-template-columns: 1fr;
  }
  .teams-line {
    grid-template-columns: 1fr;
    text-align: center;
  }
  .teams-line h1:first-child,
  .teams-line h1:last-child {
    text-align: center;
  }
  .teams-line h1 {
    font-size: 24px;
  }
  .score-block {
    font-size: 34px;
  }
  .scoreboard-head {
    padding: 16px 0 28px;
  }
}
</style>
