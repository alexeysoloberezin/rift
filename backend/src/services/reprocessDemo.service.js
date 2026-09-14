import fs from 'node:fs';
import { detachMatchDemos } from './detachDemos.service.js';

/**
 * Откатывает вклад текущей статистики в рейтинг и готовит последний
 * прикреплённый файл к повторному разбору. Сам файл не удаляется.
 */
export async function prepareMatchDemoReprocess(tx, matchId, deps = {}) {
  const fileExists = deps.fileExists || fs.existsSync;
  const { rows } = await tx.query(
    `SELECT d.* FROM demos d
     WHERE d.match_id = $1
     ORDER BY d.parsed_at DESC NULLS LAST, d.uploaded_at DESC
     LIMIT 1 FOR UPDATE`,
    [matchId]
  );
  const demo = rows[0];
  if (!demo) throw Object.assign(new Error('У матча нет привязанной демки для пересчёта'), { status: 409 });
  if (demo.status === 'parsing') throw Object.assign(new Error('Дождитесь завершения текущей обработки'), { status: 409 });
  if (!demo.storage_path || !fileExists(demo.storage_path)) {
    throw Object.assign(new Error('Файл демки не найден на сервере'), { status: 404 });
  }

  await detachMatchDemos(tx, matchId);
  await tx.query(
    `UPDATE demos SET match_id = $1, status = 'parsing', error_message = NULL,
       parsed_at = NULL, raw_stats = NULL WHERE id = $2`,
    [matchId, demo.id]
  );
  await tx.query("UPDATE matches SET status = 'parsing_demo' WHERE id = $1", [matchId]);
  return { ...demo, match_id: matchId, status: 'parsing' };
}
