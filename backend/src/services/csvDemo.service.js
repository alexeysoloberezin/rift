import fs from 'node:fs/promises';
import XLSX from 'xlsx';

export function parseCsvStats(text) {
  const workbook = XLSX.read(text.replace(/^\uFEFF/, ''), { type: 'string', raw: true });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: true });
  const screenshot = rows.length > 0 && rows.every(row => row.source === 'screenshot');
  const required = screenshot
    ? ['team', 'name', 'kills', 'deaths', 'assists', 'adr', 'head_shot_kills']
    : ['matchid', 'mapnumber', 'steamid64', 'team', 'name', 'kills', 'deaths', 'damage', 'assists', 'head_shot_kills'];
  if (!rows.length || required.some(key => !(key in rows[0]))) throw new Error('CSV должен содержать колонки matchid, mapnumber, steamid64, team, name, kills, deaths, damage, assists, head_shot_kills');
  const active = rows.filter(row => !['spectator', 'unassigned', ''].includes(String(row.team).trim().toLowerCase()));
  const teams = [...new Set(active.map(row => String(row.team).trim()))];
  if (teams.length !== 2) throw new Error('CSV должен содержать ровно две играющие команды');
  if (new Set(active.map(row => `${row.matchid}:${row.mapnumber}`)).size !== 1) throw new Error('Загрузите CSV только одного матча и одной карты');
  const ids = new Set();
  const number = (row, key, optional = false) => {
    if (optional && (!(key in row) || String(row[key]).trim() === '')) return null;
    const raw = String(row[key] ?? '').trim();
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value > 2147483647) throw new Error(`Некорректное значение ${key} у ${row.name}`);
    return value;
  };
  const players = active.map(row => {
    const steam_id = String(row.steamid64 ?? '').trim() || null;
    const identity = steam_id || String(row.name).trim().toLowerCase();
    if ((!steam_id && !screenshot) || (steam_id && !/^7656119\d{10}$/.test(steam_id)) || ids.has(identity)) throw new Error('CSV содержит неверный или повторяющийся Steam ID / ник');
    ids.add(identity);
    if (!String(row.name).trim()) throw new Error('В CSV отсутствует ник игрока');
    if (screenshot && !steam_id && /\.\.\.|…/.test(row.name)) throw new Error(`Укажите полный ник вместо «${row.name}» или заполните steamid64`);
    const decimal = key => {
      const raw = String(row[key] ?? '').trim();
      if (!raw) return null;
      if (!/^\d+(\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw)) || Number(raw) > 9999) throw new Error(`Некорректное значение ${key} у ${row.name}`);
      return Number(raw);
    };
    const kills = number(row, 'kills');
    const headshots = number(row, 'head_shot_kills');
    if (headshots > kills) throw new Error('Количество хедшотов превышает количество убийств');
    return {
      steam_id, nickname: String(row.name), side_majority: String(row.team).trim() === teams[0] ? 'A' : 'B',
      kills, deaths: number(row, 'deaths'), assists: number(row, 'assists'), damage: number(row, 'damage', screenshot), headshots,
      adr: screenshot ? decimal('adr') : null,
      source_rating: screenshot ? decimal('source_rating') : null,
      rounds_played: null, kast_rounds: null,
      multi_kills: Object.fromEntries([2, 3, 4, 5].map(n => [`${n}k`, number(row, `enemy${n}ks`, true)])),
      utility_damage: number(row, 'utility_damage', true), enemies_flashed: number(row, 'enemies_flashed', true),
      // Preserve exporter-specific metrics without pretending they are round-level demo events.
      csv_stats: row,
    };
  });
  return { source: 'csv', csv_format: screenshot ? 'screenshot' : 'match_data', map: null, rounds_total: null, team_a_score: null, team_b_score: null,
    team_a_name: teams[0], team_b_name: teams[1], players, rounds: [],
    missing_stats: ['map', 'score', 'rounds_played', 'kast', 'match_rating', 'elo'],
  };
}

export async function parseCsvFile(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > 10 * 1024 * 1024) throw new Error('CSV не должен превышать 10 МБ');
  return parseCsvStats(await fs.readFile(filePath, 'utf8'));
}
