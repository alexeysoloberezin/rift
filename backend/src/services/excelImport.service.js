import XLSX from 'xlsx';

// Правила распознавания колонок: заголовок нормализуется (нижний регистр, без
// пробелов/пунктуации) и проверяется по ПОДСТРОКЕ, а не точному совпадению —
// формы (Google Forms и т.п.) обычно оформляют заголовки полными фразами
// ("Your name", "Your FACEIT level and Elo", "Yuour number of hours in CS2",
// с опечатками и вариациями), и точное совпадение с коротким словом там
// никогда не сработает.
//
// Порядок важен: правила проверяются по очереди, для каждого заголовка
// побеждает первое совпавшее правило. Специфичные идут раньше общих — иначе,
// например, "name" внутри "nickname" или "faceit" внутри заголовка про Elo
// перехватили бы не то поле.
//   anyOf — достаточно одного ключевого слова из списка;
//   allOf — обязательны ВСЕ ключевые слова (используется, чтобы отличить
//           "FACEIT link" от "FACEIT level/Elo" — оба содержат "faceit").
const FIELD_RULES = [
  { field: 'nickname', anyOf: ['ник', 'nickname', 'nick', 'игровойник'] },
  { field: 'telegram', anyOf: ['телеграм', 'telegram', 'телега'] },
  { field: 'faceit_link', allOf: ['faceit'], anyOf: ['link', 'ссылка', 'profile', 'профиль'] },
  { field: 'elo_raw', anyOf: ['elo', 'эло', 'рейтинг', 'level', 'левел', 'лвл'] },
  { field: 'hours', anyOf: ['час', 'hour', 'playtime'] },
  // 'времен' (без окончания) — чтобы ловить и "время", и "времени"
  // (стандартный заголовок Google Forms "Отметка времени").
  { field: 'date', anyOf: ['дата', 'date', 'времен', 'timestamp'] },
  // "name"/"имя" — самое общее правило, специально в конце: и "nickname",
  // и "FACEIT level and Elo" и т.п. должны были перехватиться выше раньше,
  // чем дойдёт очередь до этого.
  { field: 'name', anyOf: ['имя', 'name', 'фио'] },
];

function normalizeHeader(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/[\s_.\-()]/g, '')
    .trim();
}

function detectFieldForHeader(header) {
  const norm = normalizeHeader(header);
  if (!norm) return null;
  for (const rule of FIELD_RULES) {
    const allOk = !rule.allOf || rule.allOf.every((kw) => norm.includes(kw));
    const anyOk = !rule.anyOf || rule.anyOf.some((kw) => norm.includes(kw));
    if (allOk && anyOk) return rule.field;
  }
  return null;
}

// Достаёт FACEIT-ник из ссылки вида
// "https://www.faceit.com/ru/players/mo4aeja" (с любым языковым префиксом,
// query-параметрами или хвостовым "/") — последний непустой сегмент пути.
// Формы регистрации почти всегда просят "ваше имя", а не игровой ник, и люди
// пишут туда что попало (реальное имя, только имя без фамилии и т.п.) — а
// вот ссылка на FACEIT почти всегда честная, и последний сегмент её URL и
// есть настоящий никнейм игрока. Возвращает null, если распарсить не вышло
// (например, вставили ссылку без /players/... вообще — тогда последним
// сегментом окажется голый домен, у которого есть точка в имени).
function extractFaceitNicknameFromLink(link) {
  if (!link) return null;
  const withoutQuery = String(link).trim().split(/[?#]/)[0];
  const segments = withoutQuery.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1];
  if (!last || last.includes('.') || last.toLowerCase() === 'players') return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// Достаёт число из ячейки, которая может быть как чистым числом, так и
// составной строкой вроде "7 lvl 1450" (уровень FACEIT + Elo в одной
// колонке) — берёт МАКСИМАЛЬНОЕ из встреченных чисел, а не склеивает все
// цифры подряд (что раньше превращало "7 lvl 1450" в 71450). Для обычной
// колонки с одним числом (часы в игре, чистый Elo) это не меняет результат.
function extractMaxNumber(raw) {
  const matches = String(raw ?? '').match(/\d+(\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  const nums = matches.map(Number).filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

/**
 * Разбирает буфер .xlsx/.xls/.csv со списком игроков турнира.
 * Первая строка листа считается заголовком. Колонки матчатся по ключевым
 * словам (см. FIELD_RULES) — порядок колонок не важен, лишние колонки
 * игнорируются.
 *
 * Возвращает массив строк вида:
 * { date, name, telegram, nickname, faceit_link, elo_raw, hours, raw_row }
 * raw_row — вся исходная строка как объект (заголовок → значение), для истории.
 */
export function parsePlayersExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  return parsePlayersRows(rows);
}

/**
 * То же самое, что parsePlayersExcel, но на входе уже готовый 2D-массив строк
 * (первая строка — заголовки) — форма, в которой Google Sheets API отдаёт
 * значения диапазона (см. googleSheets.service.js). Используется автосинком
 * из живой Google-таблицы — та же логика распознавания колонок, что и для
 * ручной загрузки .xlsx, только источник другой.
 */
export function parsePlayersRows(rows) {
  if (!rows || rows.length === 0) {
    return { players: [], warnings: ['Таблица пустая'] };
  }

  const headerRow = rows[0];
  const fieldByColumnIndex = headerRow.map((h) => detectFieldForHeader(h));

  const warnings = [];
  const unmatchedHeaders = headerRow.filter((_, i) => !fieldByColumnIndex[i]);
  if (unmatchedHeaders.length > 0) {
    warnings.push(`Не распознаны колонки: ${unmatchedHeaders.join(', ')} (сохранены в raw_row, но не замаплены)`);
  }

  // Никнейм резолвится с приоритетом: явная колонка "ник" > вытащенный из
  // ссылки FACEIT > колонка "имя" (как последний фолбэк). Колонка "имя" —
  // самый ненадёжный источник: формы регистрации спрашивают "ваше имя", и
  // туда пишут что попало (реальное имя, "Иван", половину ника и т.п.), а
  // ссылка на FACEIT почти всегда указывает на настоящий игровой аккаунт —
  // её последний URL-сегмент и есть настоящий ник (см. extractFaceitNicknameFromLink).
  const hasNicknameColumn = fieldByColumnIndex.includes('nickname');
  const hasFaceitColumn = fieldByColumnIndex.includes('faceit_link');
  const hasNameColumn = fieldByColumnIndex.includes('name');
  if (!hasNicknameColumn && hasFaceitColumn) {
    warnings.push('Отдельная колонка "ник" не найдена — никнейм определяется по ссылке FACEIT (а где её нет — по имени)');
  } else if (!hasNicknameColumn && hasNameColumn) {
    warnings.push('Отдельная колонка "ник" не найдена — в качестве никнейма использована колонка с именем');
  }
  if (!hasNicknameColumn && !hasFaceitColumn && !hasNameColumn) {
    warnings.push('Не найдена колонка с никнеймом, ссылкой FACEIT или именем игрока — импорт невозможен без неё');
  }

  const players = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((cell) => String(cell).trim() === '')) continue; // пустая строка

    const rawRow = {};
    const parsed = {};
    headerRow.forEach((h, i) => {
      rawRow[h || `col${i}`] = row[i] ?? '';
      const field = fieldByColumnIndex[i];
      if (field) parsed[field] = row[i] ?? '';
    });

    const explicitNickname = parsed.nickname && String(parsed.nickname).trim();
    const faceitNickname = extractFaceitNicknameFromLink(parsed.faceit_link);
    const nameFallback = parsed.name && String(parsed.name).trim();
    const nickname = explicitNickname || faceitNickname || nameFallback;
    if (!nickname) {
      continue; // без ника строку импортировать некуда
    }

    players.push({
      date: parsed.date || null,
      name: parsed.name || null,
      telegram: parsed.telegram || null,
      nickname: String(nickname).trim(),
      faceit_link: parsed.faceit_link || null,
      elo_raw: parsed.elo_raw ? extractMaxNumber(parsed.elo_raw) : null,
      hours: parsed.hours ? extractMaxNumber(parsed.hours) : null,
      raw_row: rawRow,
    });
  }

  return { players, warnings };
}

/**
 * Записывает распарсенные строки игроков (из parsePlayersExcel/parsePlayersRows)
 * в конкретный турнир — резолвит/создаёт players и делает upsert в
 * tournament_players (ON CONFLICT DO UPDATE — повторный запуск на тех же
 * данных не плодит дублей, только обновляет seed_rating/hours_cs2/raw_row).
 * Используется и разовой ручной загрузкой .xlsx, и автосинком из живой
 * Google-таблицы — та же логика записи, разница только в источнике строк.
 *
 * Должна вызываться внутри withTransaction (принимает tx с интерфейсом query).
 */
export async function upsertTournamentPlayers(tx, tournamentId, players) {
  const imported = [];
  for (const row of players) {
    // Ищем игрока по нику (без учёта регистра) или по ссылке faceit
    const { rows: existingRows } = await tx.query(
      `SELECT * FROM players WHERE LOWER(nickname) = LOWER($1) OR (faceit_link IS NOT NULL AND faceit_link = $2) LIMIT 1`,
      [row.nickname, row.faceit_link]
    );

    let player = existingRows[0];
    if (!player) {
      const { rows: created } = await tx.query(
        `INSERT INTO players (nickname, real_name, telegram, faceit_link)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [row.nickname, row.name, row.telegram, row.faceit_link]
      );
      player = created[0];
    } else {
      // Игрок уже существовал (найден по нику или по faceit-ссылке) —
      // обновляем его базовые поля свежими данными из этого импорта. Нужно
      // на случай, когда логика резолва ника поменялась (например, раньше
      // фолбэком бралось "имя", а теперь то же самое можно вытащить из
      // ссылки FACEIT надёжнее) — повторная загрузка того же файла
      // подтягивает более точный ник вместо разового ручного исправления
      // каждого игрока.
      const { rows: updated } = await tx.query(
        `UPDATE players SET
           nickname = COALESCE($1, nickname),
           real_name = COALESCE($2, real_name),
           telegram = COALESCE($3, telegram),
           faceit_link = COALESCE($4, faceit_link),
           updated_at = now()
         WHERE id = $5
         RETURNING *`,
        [row.nickname, row.name, row.telegram, row.faceit_link, player.id]
      );
      player = updated[0];
    }

    const { rows: tpRows } = await tx.query(
      `INSERT INTO tournament_players (tournament_id, player_id, seed_rating, hours_cs2, raw_row)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tournament_id, player_id)
       DO UPDATE SET seed_rating = EXCLUDED.seed_rating, hours_cs2 = EXCLUDED.hours_cs2, raw_row = EXCLUDED.raw_row
       RETURNING *`,
      [tournamentId, player.id, row.elo_raw, row.hours, JSON.stringify(row.raw_row)]
    );

    imported.push({ player, tournament_player: tpRows[0] });
  }
  return imported;
}
