// Реестр карт CS2 — для маленьких иконок-бейджей в списках матчей.
//
// Иконки — собственная простая геометрическая графика (не скриншоты/радары
// игры), у каждой карты свой узнаваемый силуэт и акцентный цвет, чтобы список
// матчей читался как в FACEIT — с картинкой карты, а не голым текстом.

export const MAPS = {
  cache: { label: 'Cache', short: 'CCH', color: '#819d67', glyph: 'tower' },
  dust2: { label: 'Dust II', short: 'D2', color: '#caa46b', glyph: 'sun' },
  mirage: { label: 'Mirage', short: 'MRG', color: '#d9b563', glyph: 'arch' },
  inferno: { label: 'Inferno', short: 'INF', color: '#c9622f', glyph: 'flame' },
  nuke: { label: 'Nuke', short: 'NUK', color: '#5fa3a3', glyph: 'radiation' },
  overpass: { label: 'Overpass', short: 'OVP', color: '#5f9e6c', glyph: 'wave' },
  vertigo: { label: 'Vertigo', short: 'VTG', color: '#6f89b3', glyph: 'tower' },
  ancient: { label: 'Ancient', short: 'ANC', color: '#7f9e5a', glyph: 'temple' },
  anubis: { label: 'Anubis', short: 'ANB', color: '#c9a24a', glyph: 'pyramid' },
  train: { label: 'Train', short: 'TRN', color: '#7a8896', glyph: 'rail' },
};

const DEFAULT_MAP = { label: null, short: null, color: '#b33a32', glyph: 'crosshair' };

/**
 * Приводит сырую строку карты ("de_mirage", "Mirage", "DE_DUST2" и т.п.)
 * к нашему внутреннему ключу реестра выше.
 */
function normalizeKey(raw) {
  if (!raw) return null;
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/^(de|cs|aim)_/, '');
}

/**
 * Метаданные карты для бейджа: label (человекочитаемое имя), short (2-3
 * буквы для совсем маленьких значков), color (акцент), glyph (какую иконку
 * рисовать) — с осмысленным фолбэком для ещё не занесённых в реестр карт
 * (кастомные/новые карты клуба), чтобы бейдж не ломался, а просто показывал
 * первые буквы названия.
 */
export function getMapMeta(raw) {
  const key = normalizeKey(raw);
  if (key && MAPS[key]) return MAPS[key];
  if (!raw) return { ...DEFAULT_MAP, label: 'Карта не выбрана', short: '?' };
  const label = String(raw).trim();
  const short = label.replace(/^(de|cs|aim)_/i, '').slice(0, 3).toUpperCase();
  return { ...DEFAULT_MAP, label, short };
}
