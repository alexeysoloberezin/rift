// Уровень FACEIT (1–10) считаем на фронте из elo, который уже храним как
// seed_rating (см. excelImport.service.js) — отдельного поля "уровень" в базе
// нет, а официальные пороги ELO -> уровень стабильны и общедоступны, так что
// это не расчёт "на глаз", а обычная таблица соответствия.
const LEVEL_THRESHOLDS = [
  { level: 10, min: 2001 },
  { level: 9, min: 1751 },
  { level: 8, min: 1531 },
  { level: 7, min: 1351 },
  { level: 6, min: 1201 },
  { level: 5, min: 1051 },
  { level: 4, min: 901 },
  { level: 3, min: 751 },
  { level: 2, min: 501 },
  { level: 1, min: 0 },
];

export function faceitLevel(elo) {
  if (elo === null || elo === undefined) return null;
  const n = Number(elo);
  if (Number.isNaN(n)) return null;
  for (const t of LEVEL_THRESHOLDS) {
    if (n >= t.min) return t.level;
  }
  return 1;
}
