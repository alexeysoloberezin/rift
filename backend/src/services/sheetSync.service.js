import { query, withTransaction } from '../config/db.js';
import { fetchSheetRows } from './googleSheets.service.js';
import { parsePlayersRows, upsertTournamentPlayers } from './excelImport.service.js';

// Фоновый поллер: раз в SHEET_SYNC_INTERVAL_MS проходит по всем турнирам с
// включённым sheet_sync_enabled и подтягивает актуальный список игроков из
// их Google-таблицы — тот же upsert, что и при разовой загрузке .xlsx
// (см. excelImport.service.js), просто по расписанию, а не по клику админа.
//
// Полностью безопасно держать включённым даже без настроенного Google
// Service Account: пока ни у одного турнира sheet_sync_enabled = false
// (значение по умолчанию), поллер просто ничего не делает — ключ ни разу
// не читается и ошибка не возникает.
const POLL_INTERVAL_MS = Number(process.env.SHEET_SYNC_INTERVAL_MS || 90_000);

let timer = null;
let syncInFlight = false;

async function syncTournament(t) {
  try {
    const sheetRows = await fetchSheetRows(t.sheet_id, t.sheet_range || 'A:Z');
    const { players, warnings } = parsePlayersRows(sheetRows);

    if (players.length === 0) {
      await query('UPDATE tournaments SET sheet_last_synced_at = now(), sheet_last_sync_error = $1 WHERE id = $2', [
        warnings.join('; ') || 'В таблице не найдено ни одного игрока (проверьте колонку с ником)',
        t.id,
      ]);
      return;
    }

    await withTransaction((tx) => upsertTournamentPlayers(tx, t.id, players));
    await query('UPDATE tournaments SET sheet_last_synced_at = now(), sheet_last_sync_error = NULL WHERE id = $1', [
      t.id,
    ]);
  } catch (err) {
    console.error(`❌ Автосинк Google Sheets для турнира ${t.id} упал:`, err.message);
    await query('UPDATE tournaments SET sheet_last_synced_at = now(), sheet_last_sync_error = $1 WHERE id = $2', [
      err.message,
      t.id,
    ]).catch(() => {});
  }
}

async function syncOnce() {
  if (syncInFlight) return; // предыдущий прогон ещё не закончился — не накладываем поллы друг на друга
  syncInFlight = true;
  try {
    const { rows: tournaments } = await query(
      `SELECT id, sheet_id, sheet_range FROM tournaments WHERE sheet_sync_enabled = true AND sheet_id IS NOT NULL AND sheet_id != ''`
    );
    for (const t of tournaments) {
      await syncTournament(t);
    }
  } catch (err) {
    console.error('❌ sheetSync: не удалось получить список турниров для синка:', err.message);
  } finally {
    syncInFlight = false;
  }
}

export function startSheetSyncPoller() {
  if (timer) return; // уже запущен
  syncOnce();
  timer = setInterval(syncOnce, POLL_INTERVAL_MS);
  console.log(`🔄 Автосинк Google Sheets запущен (каждые ${Math.round(POLL_INTERVAL_MS / 1000)} сек)`);
}
