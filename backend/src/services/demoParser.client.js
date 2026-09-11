import axios from 'axios';
import fs from 'node:fs';
import FormData from 'form-data';

const DEMO_PARSER_URL = process.env.DEMO_PARSER_URL || 'http://demo-parser:8001';

/**
 * Отправляет .dem файл в Python-сервис (demo-parser/) и возвращает
 * разобранную статистику по игрокам за матч.
 *
 * Контракт ответа сервиса (см. demo-parser/app/main.py):
 * {
 *   map: string,
 *   rounds_total: number,
 *   team_a_score: number,
 *   team_b_score: number,
 *   players: [{
 *     steam_id, nickname, side_majority ("A"|"B"),
 *     rounds_played, kills, deaths, assists, damage, headshots,
 *     entry_kills, entry_deaths, clutches_won, clutches_played,
 *     multi_kills: {"2k":n,"3k":n,"4k":n,"5k":n},
 *     kast_rounds
 *   }, ...]
 * }
 */
export async function parseDemoFile(filePath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));

  try {
    const { data } = await axios.post(`${DEMO_PARSER_URL}/parse`, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 10 * 60 * 1000, // парсинг демки может занимать минуты
    });
    return data;
  } catch (err) {
    // axios на 4xx/5xx кидает свою обёртку с бесполезным сообщением вида
    // "Request failed with status code 422" — вытаскиваем реальную причину
    // из тела ответа demo-parser (см. demo-parser/app/main.py), если она есть.
    if (err.response) {
      const detail = err.response.data?.error || err.response.data?.detail || JSON.stringify(err.response.data);
      throw new Error(`demo-parser [${err.response.status}]: ${detail}`);
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      throw new Error(`Не удалось достучаться до demo-parser (${DEMO_PARSER_URL}): ${err.message}`);
    }
    throw err;
  }
}
