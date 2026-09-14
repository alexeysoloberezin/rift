<script setup>
import TeamElo from '../../components/TeamElo.vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import apiClient from '../../api/client';
import StatusBadge from '../../components/StatusBadge.vue';
import MapBadge from '../../components/MapBadge.vue';
import DraftBoard from '../../components/DraftBoard.vue';
import { withScrollPreserved } from '../../lib/scroll';

const route = useRoute();
const tournamentId = route.params.id;

const tournament = ref(null);
const registeredPlayers = ref([]);
const groups = ref([]);
const bracketSlots = ref([]);
const loading = ref(true);
const selectedMvpId = ref('');
const mvpSelectionLoaded = ref(false);
const savingMvp = ref(false);
const mvpError = ref('');
const mvpSaved = ref('');

async function saveMvp() {
  savingMvp.value = true;
  mvpError.value = '';
  mvpSaved.value = '';
  try {
    const { data } = await apiClient.put(`/tournaments/${tournamentId}/mvp`, {
      player_id: selectedMvpId.value || null,
    });
    tournament.value = { ...tournament.value, ...data.data };
    mvpSaved.value = selectedMvpId.value ? 'MVP сохранён' : 'Выбор MVP сброшен';
  } catch (err) {
    mvpError.value = err.response?.data?.error || 'Не удалось сохранить MVP';
  } finally {
    savingMvp.value = false;
  }
}

// Драфт капитанов
const draft = ref(null);
const replacingPick = ref(null);
const replacementPlayerId = ref('');
const savingReplacement = ref(false);
const replacementError = ref('');
const replacementDialog = ref(null);
const removingDraftPlayer = ref(false);

async function removeDraftPlayer(pick) {
  if (removingDraftPlayer.value) return;
  if (!window.confirm(`Убрать ${pick.nickname} из команды? Игрок останется в турнире, драфт останется завершённым.`)) return;
  removingDraftPlayer.value = true;
  draftError.value = '';
  try {
    await apiClient.delete(`/tournaments/${tournamentId}/draft/picks/${pick.pick_index}`, {
      data: { expected_player_id: pick.player_id },
    });
    await loadAll();
  } catch (err) {
    draftError.value = err.response?.data?.error || 'Не удалось убрать игрока';
  } finally {
    removingDraftPlayer.value = false;
  }
}

function startPickReplacement(pick) {
  if (savingReplacement.value) return;
  replacingPick.value = pick;
  replacementPlayerId.value = '';
  replacementError.value = '';
  replacementDialog.value?.showModal();
}

async function replaceDraftPick() {
  savingReplacement.value = true;
  replacementError.value = '';
  try {
    await apiClient.put(`/tournaments/${tournamentId}/draft/picks/${replacingPick.value.pick_index}`, {
      player_id: replacementPlayerId.value,
      expected_player_id: replacingPick.value.player_id,
    });
    replacingPick.value = null;
    replacementDialog.value?.close();
    await loadAll();
  } catch (err) {
    replacementError.value = err.response?.data?.error || 'Не удалось заменить игрока';
  } finally {
    savingReplacement.value = false;
  }
}
const draftLinks = ref([]);
const draftTeamsCount = ref(8);
const startingDraft = ref(false);
const resettingDraft = ref(false);
const draftError = ref('');
const copiedToken = ref('');

function captainLinkUrl(token) {
  return `${window.location.origin}/draft/${token}`;
}

async function loadDraft() {
  const { data } = await apiClient.get(`/tournaments/${tournamentId}/draft`);
  draft.value = data.data;
  if (draft.value) {
    // pick_token публичная доска не отдаёт (см. draft.service.js) — для
    // ссылок капитанов отдельный админский запрос.
    const { data: linksData } = await apiClient.get(`/tournaments/${tournamentId}/draft/links`);
    draftLinks.value = linksData.data;
  } else {
    draftLinks.value = [];
  }
}

async function startDraft() {
  draftError.value = '';
  startingDraft.value = true;
  try {
    await apiClient.post(`/tournaments/${tournamentId}/draft/start`, { teams_count: draftTeamsCount.value });
    await loadDraft();
    await loadAll(); // подтянуть созданные драфтом команды в tournament.teams
  } catch (e) {
    draftError.value = e.response?.data?.error || 'Не удалось запустить драфт';
  } finally {
    startingDraft.value = false;
  }
}

async function resetDraft() {
  const confirmed = window.confirm(
    'Сбросить драфт? Все команды и пики, созданные драфтом, будут удалены безвозвратно.'
  );
  if (!confirmed) return;
  draftError.value = '';
  resettingDraft.value = true;
  try {
    await apiClient.delete(`/tournaments/${tournamentId}/draft`);
    await loadDraft();
    await loadAll();
  } catch (e) {
    draftError.value = e.response?.data?.error || 'Не удалось сбросить драфт';
  } finally {
    resettingDraft.value = false;
  }
}

async function copyLink(token) {
  try {
    await navigator.clipboard.writeText(captainLinkUrl(token));
    copiedToken.value = token;
    setTimeout(() => {
      if (copiedToken.value === token) copiedToken.value = '';
    }, 2000);
  } catch {
    draftError.value = 'Не удалось скопировать — скопируйте ссылку вручную';
  }
}

// Excel import
const excelFile = ref(null);
const importResult = ref(null);
const importing = ref(false);
const importError = ref('');

// Team creation
const newTeam = ref({ name: '', captain_name: '', tag: '' });
const selectedPlayerIds = ref([]);
const teamError = ref('');
const creatingTeam = ref(false);
const deletingTeamId = ref(null);
const editingCaptainTeamId = ref(null);
const captainNameInput = ref('');
const savingCaptain = ref(false);
const captainError = ref('');

function editCaptain(team) {
  editingCaptainTeamId.value = team.id;
  captainNameInput.value = team.captain_name || '';
  captainError.value = '';
}

async function saveCaptain() {
  savingCaptain.value = true;
  captainError.value = '';
  try {
    await apiClient.put(`/tournaments/${tournamentId}/teams/${editingCaptainTeamId.value}/captain`, {
      captain_name: captainNameInput.value,
    });
    editingCaptainTeamId.value = null;
    await loadAll();
  } catch (err) {
    captainError.value = err.response?.data?.error || 'Не удалось сохранить ник капитана';
  } finally {
    savingCaptain.value = false;
  }
}
const editingMatchId = ref(null);
const matchTeams = ref({ team_a_id: '', team_b_id: '' });
const savingMatchTeams = ref(false);
const matchTeamsError = ref('');

async function deleteTeam(team) {
  if (!window.confirm(`Удалить команду «${team.name}»? Она также будет убрана из группы и слотов сетки. Игроки останутся в турнире.`)) return;
  deletingTeamId.value = team.id;
  teamError.value = '';
  try {
    await apiClient.delete(`/tournaments/${tournamentId}/teams/${team.id}`);
    await loadAll();
  } catch (err) {
    teamError.value = err.response?.data?.error || 'Не удалось удалить команду';
  } finally {
    deletingTeamId.value = null;
  }
}

function editMatchTeams(match) {
  editingMatchId.value = match.id;
  matchTeams.value = { team_a_id: match.team_a_id || '', team_b_id: match.team_b_id || '' };
  matchTeamsError.value = '';
}

async function saveMatchTeams() {
  savingMatchTeams.value = true;
  matchTeamsError.value = '';
  try {
    await apiClient.put(`/matches/${editingMatchId.value}/teams`, matchTeams.value);
    editingMatchId.value = null;
    await loadAll();
  } catch (err) {
    matchTeamsError.value = err.response?.data?.error || 'Не удалось изменить команды';
  } finally {
    savingMatchTeams.value = false;
  }
}

const editingResult = ref(null);
const resultForm = ref({ map: '', score_a: '', score_b: '' });
const savingResult = ref(false);
const resultError = ref('');
function editResult(match) {
  editingResult.value = match.id;
  resultForm.value = { map: match.map || '', score_a: match.score_a ?? '', score_b: match.score_b ?? '' };
  resultError.value = '';
}
async function saveResult() {
  savingResult.value = true; resultError.value = '';
  try {
    await apiClient.put('/matches/' + editingResult.value, {
      map: resultForm.value.map || null,
      score_a: resultForm.value.score_a === '' ? null : Number(resultForm.value.score_a),
      score_b: resultForm.value.score_b === '' ? null : Number(resultForm.value.score_b),
    });
    editingResult.value = null;
    await loadAll();
  } catch (err) { resultError.value = err.response?.data?.error || 'Не удалось сохранить результат'; }
  finally { savingResult.value = false; }
}

// Match creation
const newMatch = ref({ team_a_id: '', team_b_id: '', map: '', best_of: 1, round_number: '' });
const matchError = ref('');
const creatingMatch = ref(false);
const sameTeamSelected = computed(
  () => !!newMatch.value.team_a_id && newMatch.value.team_a_id === newMatch.value.team_b_id
);

// Demo upload per match
const uploadingMatchId = ref(null);
const screenshotBusy = ref(null);
const screenshotError = ref('');
const screenshotUrl = match => apiClient.defaults.baseURL.replace(/\/$/, '') + '/matches/' + match.id + '/screenshot?v=' + encodeURIComponent(match.screenshot_version || '');
async function uploadScreenshot(match, event) {
  const file = event.target.files?.[0];
  if (!file) return;
  screenshotError.value = '';
  if (file.size > 10 * 1024 * 1024) { screenshotError.value = 'Скриншот должен быть не больше 10 МБ'; event.target.value = ''; return; }
  screenshotBusy.value = match.id;
  try {
    const body = new FormData(); body.append('screenshot', file);
    await apiClient.post('/matches/' + match.id + '/screenshot', body);
    await loadAll();
  } catch (err) { screenshotError.value = err.response?.data?.error || 'Не удалось загрузить скриншот'; }
  finally { screenshotBusy.value = null; event.target.value = ''; }
}
async function removeScreenshot(match) {
  screenshotBusy.value = match.id; screenshotError.value = '';
  try { await apiClient.delete('/matches/' + match.id + '/screenshot'); await loadAll(); }
  catch (err) { screenshotError.value = err.response?.data?.error || 'Не удалось убрать скриншот'; }
  finally { screenshotBusy.value = null; }
}
const uploadError = ref('');
const detachingMatchId = ref(null);
const detachMessage = ref('');
async function detachDemos(match) {
  if (!window.confirm('Отвязать все демо этого матча и сбросить статистику игроков? Файлы сохранятся в списке загруженных демо. Ручной счёт и скриншот останутся.')) return;
  detachingMatchId.value = match.id; uploadError.value = ''; detachMessage.value = '';
  try {
    await apiClient.post('/matches/' + match.id + '/demos/detach');
    await loadAll();
    detachMessage.value = 'Статистика сброшена. Файлы доступны в списке загруженных демо.';
  } catch (err) { uploadError.value = err.response?.data?.error || 'Не удалось отвязать демо'; }
  finally { detachingMatchId.value = null; }
}
const availableDemos = ref([]);
const selectedDemos = ref({});
async function refreshDemos() {
  const { data } = await apiClient.get('/tournaments/' + tournamentId + '/demos');
  availableDemos.value = data.data;
}
async function attachDemo(matchId) {
  uploadingMatchId.value = matchId;
  uploadError.value = '';
  try {
    await apiClient.post('/matches/' + matchId + '/demo/attach', { demo_id: selectedDemos.value[matchId] });
    selectedDemos.value[matchId] = '';
    await loadAll();
  } catch (err) {
    uploadError.value = err.response?.data?.error || 'Не удалось привязать демо';
  } finally { uploadingMatchId.value = null; }
}

// Привязка уже созданного матча к этапу турнира (группа/полуфинал/финал) —
// делается отдельно от создания матча, см. matches.routes.js PUT /matches/:id/stage.
const savingStageMatchId = ref(null);
const stageError = ref('');

function slotLabel(round, slotIndex) {
  if (round === 'final') return 'Финал';
  return `Полуфинал ${slotIndex + 1}`;
}

// Значение для v-model select'а стадии: текущая привязка матча, если есть.
function currentStage(match) {
  if (match.group_id) return `group:${match.group_id}`;
  const slot = bracketSlots.value.find((s) => (s.matches || []).some((linked) => linked.id === match.id));
  if (slot) return `${slot.round}:${slot.slot_index}`;
  return '';
}

async function setMatchStage(match, value) {
  stageError.value = '';
  savingStageMatchId.value = match.id;
  try {
    await apiClient.put(`/matches/${match.id}/stage`, { stage: value || null });
    await loadAll();
  } catch (e) {
    stageError.value = e.response?.data?.error || 'Не удалось обновить привязку матча';
  } finally {
    savingStageMatchId.value = null;
  }
}

// Match deletion
const deletingMatchId = ref(null);
const deleteError = ref('');

// Google Sheets автосинк
const sheetSource = ref({ sheet_id: '', sheet_range: 'A:Z', sheet_sync_enabled: false });
const sheetSourceLoaded = ref(false);
const sheetSourceError = ref('');
const savingSheetSource = ref(false);

let pollTimer = null;

async function loadAll() {
  // withScrollPreserved — фоновый поллинг ниже (пока парсится демка / активен
  // драфт / включён автосинк Google Sheets) иначе сбрасывал скролл страницы
  // в начало при каждом обновлении.
  await withScrollPreserved(async () => {
    const [{ data: tData }, { data: pData }, { data: gData }, { data: bData }] = await Promise.all([
      apiClient.get(`/tournaments/${tournamentId}`),
      apiClient.get(`/tournaments/${tournamentId}/players`),
      apiClient.get(`/tournaments/${tournamentId}/groups`),
      apiClient.get(`/tournaments/${tournamentId}/bracket`),
    ]);
    tournament.value = tData.data;
    registeredPlayers.value = pData.data;
    groups.value = gData.data;
    bracketSlots.value = bData.data;
    if (!mvpSelectionLoaded.value) {
      selectedMvpId.value = tournament.value.mvp_player_id || '';
      mvpSelectionLoaded.value = true;
    }
    await Promise.all([loadDraft(), refreshDemos()]);
    loading.value = false;

    // Форму источника заполняем только один раз при первой загрузке — иначе
    // фоновый поллинг ниже будет затирать то, что админ ещё не сохранил.
    if (!sheetSourceLoaded.value) {
      sheetSource.value = {
        sheet_id: tournament.value.sheet_id || '',
        sheet_range: tournament.value.sheet_range || 'A:Z',
        sheet_sync_enabled: tournament.value.sheet_sync_enabled || false,
      };
      sheetSourceLoaded.value = true;
    }
  });

  // Пока идёт разбор хоть одной демки, или включён автосинк из Google Sheets —
  // сами обновляем страницу: для демки — чтобы увидеть итог без ручного
  // reload, для автосинка — чтобы видеть новых игроков и время/ошибку синка
  // по мере того, как поллер бэкенда их подтягивает.
  clearTimeout(pollTimer);
  const isProcessing = tournament.value.matches.some((m) => m.status === 'parsing_demo');
  const isDrafting = draft.value?.status === 'active';
  if (isProcessing || tournament.value.sheet_sync_enabled || isDrafting) {
    pollTimer = setTimeout(loadAll, isProcessing || isDrafting ? 4000 : 15000);
  }
}

onUnmounted(() => clearTimeout(pollTimer));

onMounted(loadAll);

function onFileChange(e) {
  excelFile.value = e.target.files[0] || null;
}

async function submitImport() {
  if (!excelFile.value) return;
  importing.value = true;
  importError.value = '';
  importResult.value = null;
  try {
    const formData = new FormData();
    formData.append('file', excelFile.value);
    const { data } = await apiClient.post(`/tournaments/${tournamentId}/import-players`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    importResult.value = data;
    await loadAll();
  } catch (e) {
    importError.value = e.response?.data?.error || 'Не удалось импортировать файл';
  } finally {
    importing.value = false;
  }
}

async function saveSheetSource() {
  sheetSourceError.value = '';
  savingSheetSource.value = true;
  try {
    const { data } = await apiClient.put(`/tournaments/${tournamentId}/sheet-source`, sheetSource.value);
    tournament.value = { ...tournament.value, ...data.data };
    await loadAll();
  } catch (e) {
    sheetSourceError.value = e.response?.data?.error || 'Не удалось сохранить настройки автосинка';
  } finally {
    savingSheetSource.value = false;
  }
}

function togglePlayer(id) {
  const idx = selectedPlayerIds.value.indexOf(id);
  if (idx >= 0) selectedPlayerIds.value.splice(idx, 1);
  else selectedPlayerIds.value.push(id);
}

// Ручное добавление одного игрока в список турнира — без Excel/автосинка,
// например, кто-то зарегистрировался организатору лично. Бэкенд ищет игрока
// по нику/faceit-ссылке среди уже существующих в клубе, так что дублей не
// будет, даже если тот же человек позже попадёт и в Excel-импорт.
const newPlayer = ref({ nickname: '', telegram: '', faceit_link: '', seed_rating: '', hours_cs2: '' });
const addingPlayer = ref(false);
const addPlayerError = ref('');

async function addPlayer() {
  addPlayerError.value = '';
  if (!newPlayer.value.nickname.trim()) {
    addPlayerError.value = 'Укажите ник игрока';
    return;
  }
  addingPlayer.value = true;
  try {
    const { data } = await apiClient.post(`/tournaments/${tournamentId}/players`, {
      nickname: newPlayer.value.nickname.trim(),
      telegram: newPlayer.value.telegram.trim(),
      faceit_link: newPlayer.value.faceit_link.trim(),
      seed_rating: newPlayer.value.seed_rating === '' ? null : Number(newPlayer.value.seed_rating),
      hours_cs2: newPlayer.value.hours_cs2 === '' ? null : Number(newPlayer.value.hours_cs2),
    });
    // Если игрок уже был зарегистрирован в этом турнире (совпал по нику или
    // faceit-ссылке) — бэкенд просто обновил его, а не создал дубль; заменяем
    // существующую строку в списке вместо того, чтобы добавлять вторую.
    const idx = registeredPlayers.value.findIndex((x) => x.player_id === data.data.player_id);
    if (idx >= 0) registeredPlayers.value.splice(idx, 1, data.data);
    else registeredPlayers.value = [...registeredPlayers.value, data.data];
    newPlayer.value = { nickname: '', telegram: '', faceit_link: '', seed_rating: '', hours_cs2: '' };
  } catch (e) {
    addPlayerError.value = e.response?.data?.error || 'Не удалось добавить игрока';
  } finally {
    addingPlayer.value = false;
  }
}

// Статус подтверждения участия ("подтвердил / не подтвердил") — админ
// переключает его прямо в таблице кликом, без открытия формы редактирования.
const confirmingPlayerId = ref(null);
const confirmError = ref('');

async function toggleConfirmed(p) {
  confirmError.value = '';
  confirmingPlayerId.value = p.player_id;
  try {
    const { data } = await apiClient.put(`/tournaments/${tournamentId}/players/${p.player_id}/confirm`, {
      confirmed: !p.confirmed,
    });
    const idx = registeredPlayers.value.findIndex((x) => x.player_id === p.player_id);
    if (idx >= 0) registeredPlayers.value.splice(idx, 1, data.data);
  } catch (e) {
    confirmError.value = e.response?.data?.error || 'Не удалось обновить статус участия';
  } finally {
    confirmingPlayerId.value = null;
  }
}

// Редактирование полей уже зарегистрированного игрока (после импорта из
// Excel/автосинка данные часто нужно поправить руками — опечатка в нике,
// битая ссылка на faceit и т.п.) — см. PUT /tournaments/:id/players/:playerId.
const editingPlayerId = ref(null);
const playerDraft = ref({ nickname: '', telegram: '', faceit_link: '', seed_rating: null, hours_cs2: null, demo_aliases: '' });
const savingPlayerId = ref(null);
const playerEditError = ref('');

function toggleEditPlayer(p) {
  if (editingPlayerId.value === p.player_id) {
    editingPlayerId.value = null;
    return;
  }
  playerEditError.value = '';
  editingPlayerId.value = p.player_id;
  playerDraft.value = {
    nickname: p.nickname || '',
    telegram: p.telegram || '',
    faceit_link: p.faceit_link || '',
    seed_rating: p.seed_rating ?? '',
    hours_cs2: p.hours_cs2 ?? '',
    demo_aliases: (p.demo_aliases || []).join(', '),
  };
}

function cancelEditPlayer() {
  editingPlayerId.value = null;
  playerEditError.value = '';
}

// Удаление уже зарегистрированного игрока из списка турнира (не из
// глобального профиля players) — например, попал в Excel/Google-таблицу по
// ошибке или задублировался. Бэкенд сам не даст удалить, если игрок уже в
// составе команды — там прилетит понятная ошибка вместо тихого рассинхрона.
const deletingPlayerId = ref(null);
const deletePlayerError = ref('');

async function deletePlayer(p) {
  const confirmed = window.confirm(`Удалить игрока «${p.nickname}» из списка зарегистрированных?`);
  if (!confirmed) return;

  deletePlayerError.value = '';
  deletingPlayerId.value = p.player_id;
  try {
    await apiClient.delete(`/tournaments/${tournamentId}/players/${p.player_id}`);
    registeredPlayers.value = registeredPlayers.value.filter((x) => x.player_id !== p.player_id);
    selectedPlayerIds.value = selectedPlayerIds.value.filter((id) => id !== p.player_id);
    if (editingPlayerId.value === p.player_id) editingPlayerId.value = null;
  } catch (e) {
    deletePlayerError.value = e.response?.data?.error || 'Не удалось удалить игрока';
  } finally {
    deletingPlayerId.value = null;
  }
}

async function savePlayerEdit(p) {
  playerEditError.value = '';
  if (!playerDraft.value.nickname.trim()) {
    playerEditError.value = 'Ник не может быть пустым';
    return;
  }
  savingPlayerId.value = p.player_id;
  try {
    await apiClient.put(`/tournaments/${tournamentId}/players/${p.player_id}`, {
      nickname: playerDraft.value.nickname.trim(),
      telegram: (playerDraft.value.telegram || '').trim(),
      faceit_link: (playerDraft.value.faceit_link || '').trim(),
      seed_rating: playerDraft.value.seed_rating === '' ? null : Number(playerDraft.value.seed_rating),
      hours_cs2: playerDraft.value.hours_cs2 === '' ? null : Number(playerDraft.value.hours_cs2),
      demo_aliases: playerDraft.value.demo_aliases.split(/[\n,;]/).map((alias) => alias.trim()).filter(Boolean),
    });
    editingPlayerId.value = null;
    await loadAll();
  } catch (e) {
    playerEditError.value = e.response?.data?.error || 'Не удалось сохранить изменения';
  } finally {
    savingPlayerId.value = null;
  }
}

async function submitTeam() {
  teamError.value = '';
  creatingTeam.value = true;
  try {
    await apiClient.post(`/tournaments/${tournamentId}/teams`, {
      name: newTeam.value.name,
      captain_name: newTeam.value.captain_name,
      tag: newTeam.value.tag,
      player_ids: selectedPlayerIds.value,
    });
    newTeam.value = { name: '', captain_name: '', tag: '' };
    selectedPlayerIds.value = [];
    await loadAll();
  } catch (e) {
    teamError.value = e.response?.data?.error || 'Не удалось создать команду';
  } finally {
    creatingTeam.value = false;
  }
}

async function submitMatch() {
  matchError.value = '';
  if (newMatch.value.team_a_id && newMatch.value.team_a_id === newMatch.value.team_b_id) {
    matchError.value = 'Команда A и команда B не могут быть одной и той же командой';
    return;
  }
  creatingMatch.value = true;
  try {
    await apiClient.post(`/tournaments/${tournamentId}/matches`, newMatch.value);
    newMatch.value = { team_a_id: '', team_b_id: '', map: '', best_of: 1, round_number: '' };
    await loadAll();
  } catch (e) {
    matchError.value = e.response?.data?.error || 'Не удалось создать матч';
  } finally {
    creatingMatch.value = false;
  }
}

async function deleteMatch(match) {
  const label = `${match.team_a_name || 'TBD'} vs ${match.team_b_name || 'TBD'}`;
  const confirmed = window.confirm(
    `Удалить матч «${label}»? Демки и статистика удалятся безвозвратно, влияние на рейтинг игроков будет откачено.`
  );
  if (!confirmed) return;

  deleteError.value = '';
  deletingMatchId.value = match.id;
  try {
    await apiClient.delete(`/matches/${match.id}`);
    await loadAll();
  } catch (err) {
    deleteError.value = err.response?.data?.error || 'Не удалось удалить матч';
  } finally {
    deletingMatchId.value = null;
  }
}

async function uploadDemo(matchId, e) {
  const file = e.target.files[0];
  if (!file) return;
  uploadingMatchId.value = matchId;
  uploadError.value = '';
  try {
    const formData = new FormData();
    formData.append('demo', file);
    await apiClient.post(`/matches/${matchId}/demo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    await loadAll();
  } catch (err) {
    uploadError.value = err.response?.data?.error || 'Не удалось загрузить демку';
  } finally {
    uploadingMatchId.value = null;
    e.target.value = '';
  }
}
</script>

<template>
  <div class="container" v-if="!loading && tournament">
    <div class="page-head">
      <h1>{{ tournament.name }}</h1>
      <div class="page-head__right">
        <RouterLink :to="`/tournaments/${tournamentId}/draft`" class="btn">Драфт (зрительский вид)</RouterLink>
        <RouterLink :to="`/admin/tournaments/${tournamentId}/groups`" class="btn">Группы</RouterLink>
        <RouterLink :to="`/admin/tournaments/${tournamentId}/bracket`" class="btn">Плей-офф</RouterLink>
        <StatusBadge :status="tournament.status" />
      </div>
    </div>

    <section class="card block mvp-picker">
      <div>
        <p class="admin-kicker">Итоги турнира</p>
        <h2>MVP турнира</h2>
        <p class="text-muted hint">Выберите игрока вручную. На главной автоматически покажутся его средний рейтинг, ADR, K/D и число сыгранных карт.</p>
      </div>
      <div class="mvp-picker__controls">
        <select v-model="selectedMvpId" :disabled="savingMvp">
          <option value="">MVP не выбран</option>
          <option v-for="player in registeredPlayers" :key="player.player_id" :value="player.player_id">
            {{ player.nickname }}
          </option>
        </select>
        <button class="btn btn-primary" :disabled="savingMvp" @click="saveMvp">
          {{ savingMvp ? 'Сохраняем…' : 'Сохранить MVP' }}
        </button>
      </div>
      <p v-if="mvpError" class="delta-negative">{{ mvpError }}</p>
      <p v-else-if="mvpSaved" class="delta-positive">{{ mvpSaved }}</p>
    </section>

    <section class="card block">
      <h2>Импорт игроков из Excel</h2>
      <p class="text-muted hint">
        Первая строка — заголовки. Колонки узнаются по названию (ник, faceit, часы, telegram и т.п.),
        порядок не важен.
      </p>
      <div class="import-row">
        <input type="file" accept=".xlsx,.xls,.csv" @change="onFileChange" />
        <button class="btn btn-primary" :disabled="!excelFile || importing" @click="submitImport">
          {{ importing ? 'Импортируем…' : 'Импортировать' }}
        </button>
      </div>
      <p v-if="importError" class="delta-negative">{{ importError }}</p>
      <div v-if="importResult" class="import-result">
        <p class="delta-positive">Импортировано игроков: {{ importResult.imported_count }}</p>
        <p v-for="(w, i) in importResult.warnings" :key="i" class="text-muted">{{ w }}</p>
      </div>
    </section>

    <section class="card block">
      <h2>Google Sheets — автосинк вместо ручной загрузки</h2>
      <p class="text-muted hint">
        Живая Google-таблица (например, ответы Google Формы) вместо разовой загрузки .xlsx — список игроков
        сам подтягивается каждые 1–2 минуты. Таблицу нужно расшарить (доступ «Читатель») на email
        сервис-аккаунта — см. README, раздел про Google Sheets.
      </p>
      <div class="form-grid sheet-source-grid">
        <input v-model="sheetSource.sheet_id" type="text" placeholder="ID таблицы (из её URL)" />
        <input v-model="sheetSource.sheet_range" type="text" placeholder="Диапазон, напр. Лист1!A:Z" />
        <label class="sheet-toggle">
          <input type="checkbox" v-model="sheetSource.sheet_sync_enabled" />
          Включить автосинк
        </label>
        <button class="btn btn-primary" :disabled="savingSheetSource" @click="saveSheetSource">
          {{ savingSheetSource ? 'Сохраняем…' : 'Сохранить' }}
        </button>
      </div>
      <p v-if="sheetSourceError" class="delta-negative">{{ sheetSourceError }}</p>
      <p v-if="tournament.sheet_sync_enabled" class="text-muted mono sync-status">
        Последний синк: {{ tournament.sheet_last_synced_at ? new Date(tournament.sheet_last_synced_at).toLocaleString() : 'ещё не было' }}
      </p>
      <p v-if="tournament.sheet_last_sync_error" class="delta-negative">
        Ошибка синка: {{ tournament.sheet_last_sync_error }}
      </p>
    </section>

    <section class="card block">
      <h2>Зарегистрированные игроки ({{ registeredPlayers.length }})</h2>
      <p v-if="tournament.sheet_sync_enabled" class="text-muted hint">
        Включён автосинк из Google Sheets — если удалённый игрок всё ещё есть в таблице, он подтянется снова
        при следующем синке. Чтобы удалить насовсем, сначала уберите его строку из таблицы.
      </p>

      <div class="form-grid add-player-grid">
        <input v-model="newPlayer.nickname" type="text" placeholder="Ник*" @keyup.enter="addPlayer" />
        <input v-model="newPlayer.telegram" type="text" placeholder="Telegram (без @)" @keyup.enter="addPlayer" />
        <input v-model="newPlayer.faceit_link" type="text" placeholder="Ссылка FACEIT" @keyup.enter="addPlayer" />
        <input v-model="newPlayer.seed_rating" type="number" placeholder="Seed elo" @keyup.enter="addPlayer" />
        <input v-model="newPlayer.hours_cs2" type="number" placeholder="Часы в игре" @keyup.enter="addPlayer" />
        <button class="btn btn-primary" :disabled="addingPlayer || !newPlayer.nickname.trim()" @click="addPlayer">
          {{ addingPlayer ? 'Добавляем…' : 'Добавить игрока' }}
        </button>
      </div>
      <p v-if="addPlayerError" class="delta-negative">{{ addPlayerError }}</p>

      <div class="players-table" v-if="registeredPlayers.length">
        <div class="scoreboard-row players-head mono text-muted">
          <span></span>
          <span>Ник</span>
          <span>Seed elo</span>
          <span>Часы</span>
          <span>Участие</span>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <template v-for="p in registeredPlayers" :key="p.player_id">
          <div class="scoreboard-row players-row" @click="togglePlayer(p.player_id)">
            <input
              type="checkbox"
              :checked="selectedPlayerIds.includes(p.player_id)"
              @click.stop
              @change="togglePlayer(p.player_id)"
            />
            <span>{{ p.nickname }}</span>
            <span class="mono">{{ p.seed_rating ?? '—' }}</span>
            <span class="mono">{{ p.hours_cs2 ?? '—' }}</span>
            <button
              type="button"
              class="confirm-btn"
              :class="{ 'confirm-btn--confirmed': p.confirmed }"
              :disabled="confirmingPlayerId === p.player_id"
              :title="p.confirmed ? 'Подтвердил участие — нажмите, чтобы снять отметку' : 'Не подтвердил — нажмите, чтобы отметить'"
              @click.stop="toggleConfirmed(p)"
            >
              <span class="confirm-btn__dot"></span>
              {{ confirmingPlayerId === p.player_id ? '…' : (p.confirmed ? 'Подтвердил' : 'Не подтв.') }}
            </button>
            <a
              v-if="p.faceit_link"
              :href="p.faceit_link"
              target="_blank"
              rel="noopener noreferrer"
              class="edit-btn faceit-link-btn"
              title="Открыть профиль FACEIT"
              @click.stop
            >
              ↗
            </a>
            <span v-else class="edit-btn faceit-link-btn faceit-link-btn--empty" title="Ссылка FACEIT не указана">
              ↗
            </span>
            <button type="button" class="edit-btn" title="Изменить данные игрока" @click.stop="toggleEditPlayer(p)">
              {{ editingPlayerId === p.player_id ? '✕' : '✎' }}
            </button>
            <button
              type="button"
              class="edit-btn delete-btn"
              title="Удалить игрока из списка"
              :disabled="deletingPlayerId === p.player_id"
              @click.stop="deletePlayer(p)"
            >
              {{ deletingPlayerId === p.player_id ? '…' : '🗑' }}
            </button>
          </div>
          <div v-if="editingPlayerId === p.player_id" class="player-edit-row" @click.stop>
            <div class="player-edit-grid">
              <label>
                Ник
                <input v-model="playerDraft.nickname" type="text" />
              </label>
              <label>
                Telegram
                <input v-model="playerDraft.telegram" type="text" placeholder="без @" />
              </label>
              <label>
                Ссылка FACEIT
                <input v-model="playerDraft.faceit_link" type="text" />
              </label>
              <label>
                Seed elo
                <input v-model="playerDraft.seed_rating" type="number" />
              </label>
              <label>
                Часы в игре
                <input v-model="playerDraft.hours_cs2" type="number" />
              </label>
              <label class="demo-alias-field">
                Ники в демках
                <input v-model="playerDraft.demo_aliases" type="text" placeholder="например: 纪律, другой ник" />
                <small>Через запятую. Основной ник игрока не изменится.</small>
              </label>
            </div>
            <p class="text-muted alias-hint">Для уже разобранной демки сохраните псевдоним, затем отвяжите демку от матча и привяжите её снова.</p>
            <div class="player-edit-actions">
              <button class="btn btn-primary" :disabled="savingPlayerId === p.player_id" @click="savePlayerEdit(p)">
                {{ savingPlayerId === p.player_id ? 'Сохраняем…' : 'Сохранить' }}
              </button>
              <button class="btn" @click="cancelEditPlayer">Отмена</button>
            </div>
            <p v-if="playerEditError" class="delta-negative">{{ playerEditError }}</p>
          </div>
        </template>
      </div>
      <p v-else class="text-muted">Импортируйте Excel, чтобы список появился здесь.</p>
      <p v-if="deletePlayerError" class="delta-negative">{{ deletePlayerError }}</p>
      <p v-if="confirmError" class="delta-negative">{{ confirmError }}</p>
    </section>

    <section class="card block">
      <h2>Драфт капитанов</h2>
      <template v-if="!draft">
        <p class="text-muted hint">
          Топ‑N игроков по seed elo (текущий «Рейтинг турнира») автоматически станут капитанами и получат свои
          команды. Дальше капитаны по очереди выбирают игроков по личным ссылкам — без входа в аккаунт. Порядок —
          «змейка»: слабейший по elo капитан пикает первым в каждом раунде, следующий раунд идёт в обратном порядке.
        </p>
        <p class="text-muted hint">Требует, чтобы у турнира ещё не было команд — драфт создаёт их с нуля.</p>
        <div class="form-inline">
          <input v-model.number="draftTeamsCount" type="number" min="2" placeholder="Число команд" style="width: 160px" />
          <button class="btn btn-primary" :disabled="startingDraft || !draftTeamsCount" @click="startDraft">
            {{ startingDraft ? 'Запускаем…' : 'Начать драфт' }}
          </button>
        </div>
        <p v-if="draftError" class="delta-negative">{{ draftError }}</p>
      </template>

      <template v-else>
        <DraftBoard :data="draft" can-replace @replace="startPickReplacement" @remove="removeDraftPlayer" />
        <dialog ref="replacementDialog" class="replacement-dialog card" @cancel="savingReplacement ? $event.preventDefault() : replacingPick = null">
        <form v-if="replacingPick" @submit.prevent="replaceDraftPick">
          <h3>Заменить {{ replacingPick.nickname }} (пик №{{ replacingPick.pick_index + 1 }})</h3>
          <p class="text-muted">Игрок вернётся в свободный пул. Очередь пиков сохранится.</p>
          <select v-model="replacementPlayerId" :disabled="savingReplacement" aria-label="Новый игрок">
            <option disabled value="">Выберите замену</option>
            <option v-for="player in draft.available_players" :key="player.id" :value="player.id">{{ player.nickname }}</option>
          </select>
          <button class="btn btn-primary" :disabled="savingReplacement || !replacementPlayerId">{{ savingReplacement ? 'Сохраняем…' : 'Заменить игрока' }}</button>
          <button type="button" class="btn" :disabled="savingReplacement" @click="replacementDialog.close(); replacingPick = null">Отмена</button>
          <p v-if="!draft.available_players.length" class="text-muted">Нет свободных игроков для замены.</p>
          <p v-if="replacementError" class="delta-negative" role="alert">{{ replacementError }}</p>
        </form>
        </dialog>

        <h3 class="links-title">Ссылки капитанов</h3>
        <p class="text-muted hint">
          Отправь каждому капитану его личную ссылку (например, в Telegram) — по ней он пикает без входа в аккаунт.
        </p>
        <div class="captain-links">
          <div v-for="l in draftLinks" :key="l.team_id" class="captain-link-row">
            <span class="captain-link-name">
              {{ l.captain_nickname }} <span class="text-muted">({{ l.team_name }})</span>
              <TeamElo :value="draft.teams.find(team => team.team_id === l.team_id)?.average_elo" />
            </span>
            <code class="mono captain-link-url">{{ captainLinkUrl(l.pick_token) }}</code>
            <button class="btn" @click="copyLink(l.pick_token)">
              {{ copiedToken === l.pick_token ? 'Скопировано!' : 'Копировать' }}
            </button>
          </div>
        </div>

        <button class="btn btn-danger reset-draft-btn" :disabled="resettingDraft" @click="resetDraft">
          {{ resettingDraft ? 'Сбрасываем…' : 'Сбросить драфт' }}
        </button>
        <p v-if="draftError" class="delta-negative">{{ draftError }}</p>
      </template>
    </section>

    <section class="card block">
      <h2>Команды</h2>
      <div class="form-inline">
        <input v-model="newTeam.name" type="text" placeholder="Название команды" />
        <input v-model="newTeam.captain_name" type="text" placeholder="Ник капитана в CS2" />
        <input v-model="newTeam.tag" type="text" placeholder="Тег (необязательно)" style="width: 180px" />
        <button class="btn btn-primary" :disabled="!newTeam.name || creatingTeam" @click="submitTeam">
          {{ creatingTeam ? 'Создаём…' : `Создать (${selectedPlayerIds.length} выбрано)` }}
        </button>
      </div>
      <p v-if="teamError" class="delta-negative">{{ teamError }}</p>
      <p class="text-muted hint">Ник капитана используется для привязки команды при загрузке демо. Укажите его точно как в игре.</p>

      <div class="teams-list">
        <div v-for="team in tournament.teams" :key="team.id" class="card team-chip">
          <strong>{{ team.name }} <TeamElo :value="team.average_elo" /></strong>
          <span v-if="team.captain_name" class="text-muted">Капитан: {{ team.captain_name }}</span>
          <button class="btn" :disabled="savingCaptain" @click="editCaptain(team)">
            {{ team.captain_name ? 'Изменить ник капитана' : 'Указать ник капитана' }}
          </button>
          <form v-if="editingCaptainTeamId === team.id" class="captain-name-editor" @submit.prevent="saveCaptain">
            <label>Ник капитана в CS2
              <input v-model="captainNameInput" maxlength="128" :disabled="savingCaptain" placeholder="Точно как в демо" />
            </label>
            <button class="btn btn-primary" :disabled="savingCaptain">{{ savingCaptain ? 'Сохраняем…' : 'Сохранить' }}</button>
            <button type="button" class="btn" :disabled="savingCaptain" @click="editingCaptainTeamId = null">Отмена</button>
            <p v-if="captainError" class="delta-negative" role="alert">{{ captainError }}</p>
          </form>
          <span class="text-muted mono">{{ team.players.length }} игроков</span>
          <button class="btn btn-danger" :disabled="deletingTeamId !== null" @click="deleteTeam(team)">
            {{ deletingTeamId === team.id ? 'Удаляем…' : 'Удалить команду' }}
          </button>
        </div>
      </div>
    </section>

    <section class="card block">
      <h2>Матчи</h2>
      <p class="text-muted hint">Создайте матч, затем выберите загруженное демо. Загрузка через API сохраняет файл без создания матча. Статистика рассчитывается после привязки.</p>
      <button class="btn" @click="refreshDemos().catch(() => uploadError = 'Не удалось обновить список демо')">Обновить список демо ({{ availableDemos.length }})</button>
      <div class="form-grid">
        <select v-model="newMatch.team_a_id">
          <option value="">Команда A</option>
          <option v-for="t in tournament.teams" :key="t.id" :value="t.id">{{ t.name }} · Среднее Elo {{ t.average_elo == null ? '—' : Number(t.average_elo).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) }}</option>
        </select>
        <select v-model="newMatch.team_b_id">
          <option value="">Команда B</option>
          <option v-for="t in tournament.teams" :key="t.id" :value="t.id">{{ t.name }} · Среднее Elo {{ t.average_elo == null ? '—' : Number(t.average_elo).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) }}</option>
        </select>
        <input v-model="newMatch.map" type="text" placeholder="Карта (de_mirage)" />
        <input v-model.number="newMatch.best_of" type="number" min="1" max="5" placeholder="BO" />
        <input v-model="newMatch.round_number" type="text" placeholder="Стадия (1/4 финала)" />
        <button class="btn btn-primary" :disabled="creatingMatch || sameTeamSelected" @click="submitMatch">
          {{ creatingMatch ? 'Создаём…' : 'Создать матч' }}
        </button>
      </div>
      <p v-if="sameTeamSelected" class="delta-negative">Команда A и команда B не могут совпадать</p>
      <p v-if="matchError" class="delta-negative">{{ matchError }}</p>

      <p class="text-muted hint stage-hint">
        Привязка матча к группе или к слоту плей-офф (полуфинал/финал) задаётся ниже, у уже созданного
        матча — а не при его создании.
      </p>
      <div class="card matches-list">
        <div v-for="m in tournament.matches" :key="m.id" class="scoreboard-row match-manage-row">
          <MapBadge :map="m.map" size="sm" :show-label="false" />
          <RouterLink :to="`/matches/${m.id}`" class="match-manage-row__name">
            {{ m.team_a_name || 'TBD' }} <TeamElo v-if="m.team_a_name" :value="m.team_a_average_elo" /> vs {{ m.team_b_name || 'TBD' }} <TeamElo v-if="m.team_b_name" :value="m.team_b_average_elo" />
          </RouterLink>
          <StatusBadge :status="m.status" />
          <button class="btn" :disabled="m.status === 'parsing_demo'" @click="editResult(m)">
            {{ m.score_a == null ? 'Указать карту и счёт' : `Изменить счёт ${m.score_a}:${m.score_b}` }}
          </button>
          <form v-if="editingResult === m.id" class="match-team-editor" @submit.prevent="saveResult">
            <label>Карта<input v-model="resultForm.map" placeholder="de_mirage" /></label>
            <label>Счёт {{ m.team_a_name || 'команды A' }}<input v-model="resultForm.score_a" type="number" min="0" max="1000" step="1" /></label>
            <label>Счёт {{ m.team_b_name || 'команды B' }}<input v-model="resultForm.score_b" type="number" min="0" max="1000" step="1" /></label>
            <button class="btn btn-primary" :disabled="savingResult">Сохранить</button>
            <button class="btn" type="button" :disabled="savingResult" @click="editingResult = null">Отмена</button>
            <p v-if="resultError" class="delta-negative">{{ resultError }}</p>
          </form>
          <button class="btn" :disabled="m.status === 'parsing_demo' || savingMatchTeams" @click="editMatchTeams(m)">Изменить команды</button>
          <div v-if="editingMatchId === m.id" class="match-team-editor">
            <label>Команда A
              <select v-model="matchTeams.team_a_id" :disabled="savingMatchTeams">
                <option disabled value="">Выберите команду</option>
                <option v-for="team in tournament.teams" :key="team.id" :value="team.id">{{ team.name }} · Среднее Elo {{ team.average_elo == null ? '—' : Number(team.average_elo).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) }}</option>
              </select>
            </label>
            <label>Команда B
              <select v-model="matchTeams.team_b_id" :disabled="savingMatchTeams">
                <option disabled value="">Выберите команду</option>
                <option v-for="team in tournament.teams" :key="team.id" :value="team.id">{{ team.name }} · Среднее Elo {{ team.average_elo == null ? '—' : Number(team.average_elo).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) }}</option>
              </select>
            </label>
            <button class="btn btn-primary" :disabled="savingMatchTeams || !matchTeams.team_a_id || !matchTeams.team_b_id || matchTeams.team_a_id === matchTeams.team_b_id" @click="saveMatchTeams">{{ savingMatchTeams ? 'Сохраняем…' : 'Сохранить' }}</button>
            <button class="btn" :disabled="savingMatchTeams" @click="editingMatchId = null">Отмена</button>
            <p class="text-muted">Счёт и статистика остаются на своих сторонах A и B.</p>
            <p v-if="matchTeamsError" class="delta-negative">{{ matchTeamsError }}</p>
          </div>
          <select
            class="stage-select"
            :value="currentStage(m)"
            :disabled="savingStageMatchId === m.id"
            @change="(e) => setMatchStage(m, e.target.value)"
          >
            <option value="">Без этапа</option>
            <optgroup label="Группа" v-if="groups.length">
              <option v-for="g in groups" :key="g.id" :value="`group:${g.id}`">{{ g.name }}</option>
            </optgroup>
            <optgroup label="Плей-офф" v-if="bracketSlots.length">
              <option v-for="s in bracketSlots" :key="s.id" :value="`${s.round}:${s.slot_index}`">
                {{ slotLabel(s.round, s.slot_index) }}
              </option>
            </optgroup>
          </select>
          <select :value="selectedDemos[m.id] || ''" @change="selectedDemos[m.id] = $event.target.value" aria-label="Загруженное демо" :disabled="uploadingMatchId !== null || m.status === 'parsing_demo'">
            <option value="" disabled>Выберите загруженное демо</option>
            <option v-for="demo in availableDemos" :key="demo.id" :value="demo.id">{{ demo.original_name }} · {{ new Date(demo.uploaded_at).toLocaleString('ru-RU') }}</option>
          </select>
          <button class="btn btn-primary" :disabled="!selectedDemos[m.id] || uploadingMatchId !== null || m.status === 'parsing_demo'" @click="attachDemo(m.id)">Привязать демо</button>
          <label class="btn upload-btn">
            {{ screenshotBusy === m.id ? 'Загрузка…' : m.screenshot_version ? 'Заменить скрин статистики' : 'Загрузить скрин статистики' }}
            <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="screenshotBusy !== null" hidden @change="uploadScreenshot(m, $event)" />
          </label>
          <a v-if="m.screenshot_version" :href="screenshotUrl(m)" target="_blank" rel="noopener" class="btn">Посмотреть скрин</a>
          <button v-if="m.screenshot_version" class="btn" :disabled="screenshotBusy !== null" @click="removeScreenshot(m)">Убрать скрин</button>
          <button class="btn" :disabled="detachingMatchId !== null || uploadingMatchId !== null || m.status === 'parsing_demo'" @click="detachDemos(m)">{{ detachingMatchId === m.id ? 'Сбрасываем…' : 'Отвязать демо и сбросить стату' }}</button>
          <label class="btn upload-btn">
            {{ uploadingMatchId === m.id ? 'Загрузка…' : 'Загрузить .dem / .csv' }}
            <input type="file" accept=".dem,.csv" hidden @change="(e) => uploadDemo(m.id, e)" />
          </label>
          <button
            class="btn btn-danger"
            :disabled="deletingMatchId === m.id"
            @click="deleteMatch(m)"
          >
            {{ deletingMatchId === m.id ? 'Удаляем…' : 'Удалить' }}
          </button>
        </div>
        <p v-if="tournament.matches.length === 0" class="text-muted" style="padding: 16px">Матчей ещё нет.</p>
      </div>
      <p v-if="screenshotError" class="delta-negative" role="alert">{{ screenshotError }}</p>
      <p v-if="detachMessage" class="text-muted" role="status">{{ detachMessage }}</p>
      <p v-if="uploadError" class="delta-negative">{{ uploadError }}</p>
      <p v-if="deleteError" class="delta-negative">{{ deleteError }}</p>
      <p v-if="stageError" class="delta-negative">{{ stageError }}</p>
    </section>
  </div>
  <p v-else class="container text-muted">Загрузка…</p>
</template>

<style scoped>
.replacement-dialog {
  width: min(520px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  padding: 24px;
  color: var(--text);
  background: var(--bg-elevated);
}
.replacement-dialog::backdrop { background: rgb(0 0 0 / 65%); }
.replacement-dialog form { display: grid; gap: 12px; }
.captain-name-editor {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 8px;
  width: 100%;
}
.captain-name-editor label { display: grid; gap: 6px; }
.captain-name-editor p { flex-basis: 100%; }
.match-team-editor {
  grid-column: 1 / -1;
  flex-basis: 100%;
  order: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
}
.match-team-editor label { display: grid; gap: 6px; }
.match-team-editor p { flex-basis: 100%; }
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
}

.page-head h1 {
  font-size: 32px;
}

.page-head__right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.block {
  padding: 24px;
  margin-bottom: 24px;
}

.block h2 {
  font-size: 18px;
  margin-bottom: 8px;
}

.hint {
  font-size: 13px;
  margin-bottom: 16px;
}

.import-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.form-grid.sheet-source-grid {
  grid-template-columns: 1.4fr 1fr auto auto;
}

.sheet-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  white-space: nowrap;
}

.sync-status {
  margin-top: 10px;
  font-size: 12px;
}

.import-result {
  margin-top: 14px;
  font-size: 14px;
}

.links-title {
  font-size: 15px;
  margin-top: 20px;
  margin-bottom: 6px;
}

.captain-links {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.captain-link-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-inset);
  flex-wrap: wrap;
}

.captain-link-name {
  font-weight: 600;
  font-size: 13px;
  flex: none;
  min-width: 140px;
}

.captain-link-url {
  font-size: 12px;
  color: var(--text-muted);
  flex: 1;
  overflow-wrap: anywhere;
}

.reset-draft-btn {
  margin-top: 16px;
}

.players-table {
  margin-top: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}

.players-head,
.players-row {
  display: grid;
  grid-template-columns: 24px 1fr 100px 80px 110px 32px 32px 32px;
  align-items: center;
  gap: 8px;
}

.players-head {
  text-transform: uppercase;
  font-size: 11px;
  border-bottom: 1px solid var(--line);
}

.players-row {
  cursor: pointer;
  border-bottom: 1px solid var(--line);
}

.players-table > *:last-child {
  border-bottom: none;
}

.edit-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
  border-radius: 4px;
}

.edit-btn:hover {
  color: var(--red-strong);
  background: var(--bg-inset);
}

.edit-btn.delete-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* Статус подтверждения участия — переключается кликом прямо в таблице.
   Цвет "подтвердил" — единственный "положительный" акцент в палитре (gold,
   см. theme.css), а не зелёный, которого в чёрно-красной теме клуба
   намеренно нет. "Не подтвердил" — нейтральный приглушённый, не красный:
   это не ошибка, просто ещё нет ответа. */
.confirm-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: var(--radius);
  white-space: nowrap;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.confirm-btn:hover {
  border-color: var(--text-muted);
}

.confirm-btn__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-dim);
  flex: none;
}

.confirm-btn--confirmed {
  border-color: color-mix(in srgb, var(--gold) 50%, var(--line));
  color: var(--gold);
  background: color-mix(in srgb, var(--gold) 8%, transparent);
}

.confirm-btn--confirmed .confirm-btn__dot {
  background: var(--gold);
}

.confirm-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.faceit-link-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
}

.faceit-link-btn--empty {
  opacity: 0.3;
  cursor: default;
}

.faceit-link-btn--empty:hover {
  color: var(--text-muted);
  background: transparent;
}

.player-edit-row {
  padding: 14px 12px;
  background: var(--bg-inset);
  border-bottom: 1px solid var(--line);
  cursor: default;
}

.player-edit-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}

.player-edit-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.player-edit-grid .demo-alias-field {
  grid-column: 1 / -1;
}

.demo-alias-field small,
.alias-hint {
  font-size: 11px;
  text-transform: none;
  letter-spacing: normal;
}

.alias-hint {
  margin-top: 10px;
}

.player-edit-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.form-inline {
  display: flex;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.teams-list {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.team-chip {
  padding: 10px 16px;
  display: flex;
  gap: 10px;
  align-items: center;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr) auto;
  gap: 10px;
  margin-top: 12px;
}

.mvp-picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 420px);
  align-items: center;
  gap: 24px;
  border-color: color-mix(in srgb, var(--gold) 42%, var(--line));
}

.admin-kicker {
  margin-bottom: 4px;
  color: var(--gold);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.mvp-picker__controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
}

.stage-hint {
  margin-top: 16px;
  margin-bottom: 0;
}

.matches-list {
  margin-top: 12px;
}

.match-manage-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
}

.stage-select {
  font-size: 13px;
}

.match-manage-row__name {
  flex: 1;
  min-width: 140px;
  font-weight: 600;
}

.match-manage-row__name:hover {
  color: var(--red-strong);
}

.upload-btn {
  cursor: pointer;
}

/* Админка турнира — самая "тяжёлая" по вёрстке страница в проекте (жёсткие
   пиксельные/5-6-колоночные грид-строки формы), и именно она чаще всего
   ломалась на телефоне. Ниже — не косметика, а разбор по каждому такому
   месту: плотные грид-формы стоят в 1 колонку, строки-действия переходят
   с grid на flex-wrap, чтобы поля сами переносились, а не наезжали друг
   на друга. */
@media (max-width: 720px) {
  .mvp-picker,
  .mvp-picker__controls {
    grid-template-columns: 1fr;
  }

  .form-grid,
  .form-grid.sheet-source-grid {
    grid-template-columns: 1fr;
  }

  .player-edit-grid {
    grid-template-columns: 1fr 1fr;
  }

  .match-manage-row {
    display: grid;
    grid-template-columns: 1fr;
    justify-items: start;
    row-gap: 8px;
  }

  .match-manage-row__name {
    order: -1;
  }

  .captain-link-row {
    flex-direction: column;
    align-items: stretch;
  }

  .captain-link-name {
    min-width: 0;
  }
}

@media (max-width: 480px) {
  .page-head h1 {
    font-size: 24px;
  }

  /* Ник + seed elo + часы + статус участия + кнопки faceit/правки/удаления в
     8 узких колонках на телефоне сминались в нечитаемую строку — оставляем
     чекбокс/ник/статус участия (важно видеть сразу) и кнопки правки/удаления;
     seed elo, часы и ссылку faceit всё равно видно и правится в открывшейся
     форме редактирования. */
  .players-head,
  .players-row {
    grid-template-columns: 24px 1fr 100px 32px 32px;
  }

  .players-head > :nth-child(3),
  .players-head > :nth-child(4),
  .players-head > :nth-child(6),
  .players-row > :nth-child(3),
  .players-row > :nth-child(4),
  .players-row > :nth-child(6) {
    display: none;
  }

  .confirm-btn {
    font-size: 10px;
    padding: 4px 6px;
  }

  .player-edit-grid {
    grid-template-columns: 1fr;
  }
}
</style>
