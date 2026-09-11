import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import axios from 'axios';

// Читаем список игроков из ЖИВОЙ приватной Google-таблицы через Sheets API v4.
//
// Нарочно без пакета googleapis (тяжёлый, тянет кучу транзитивных зависимостей) —
// jsonwebtoken уже используется в проекте для админского JWT, тем же способом
// подписываем "assertion" сервис-аккаунта Google (RS256) и меняем его на
// access token через стандартный OAuth2 token endpoint. Дальше обычный REST-
// запрос к Sheets API через axios (тоже уже есть в зависимостях).
//
// ВАЖНО про секрет: ключ сервис-аккаунта — это JSON-файл, который НЕЛЬЗЯ
// коммитить в git и НЕЛЬЗЯ хардкодить в коде (см. README про утечку в самом
// начале проекта). Путь к файлу передаётся через переменную окружения
// GOOGLE_SERVICE_ACCOUNT_KEY_FILE — сам файл лежит вне репозитория/в
// gitignore-нутой папке secrets/.

let cachedServiceAccount = null;
let cachedToken = null; // { accessToken, expiresAtMs }

function loadServiceAccount() {
  if (cachedServiceAccount) return cachedServiceAccount;

  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (!keyFile) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY_FILE не задан в .env — нужен путь к JSON-ключу сервис-аккаунта Google'
    );
  }
  if (!fs.existsSync(keyFile)) {
    throw new Error(`Файл ключа сервис-аккаунта не найден: ${keyFile}`);
  }

  const raw = fs.readFileSync(keyFile, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('В JSON-ключе сервис-аккаунта нет client_email/private_key — файл повреждён или не тот');
  }
  cachedServiceAccount = parsed;
  return parsed;
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs > now + 30_000) {
    return cachedToken.accessToken;
  }

  const sa = loadServiceAccount();
  const nowSec = Math.floor(now / 1000);
  const assertion = jwt.sign(
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600,
    },
    sa.private_key,
    { algorithm: 'RS256' }
  );

  const { data } = await axios.post(
    'https://oauth2.googleapis.com/token',
    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    })
  );

  cachedToken = { accessToken: data.access_token, expiresAtMs: now + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

/**
 * Возвращает содержимое диапазона таблицы как 2D-массив строк — та же форма,
 * что и XLSX.utils.sheet_to_json(sheet, {header: 1}) для .xlsx (см.
 * excelImport.service.js), поэтому дальше используется тот же парсер строк.
 *
 * @param {string} spreadsheetId — ID таблицы из её URL
 * @param {string} range — диапазон в A1-нотации, напр. "Лист1!A:Z"
 */
export async function fetchSheetRows(spreadsheetId, range) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range || 'A:Z')}`;

  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      params: { valueRenderOption: 'UNFORMATTED_VALUE' },
    });
    return data.values || [];
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    throw new Error(`Google Sheets API: ${detail}`);
  }
}
