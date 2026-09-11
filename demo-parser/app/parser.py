"""
RIFT demo-parser — разбор .dem файлов CS2 в статистику по игрокам.

Использует demoparser2 (https://github.com/LaihoE/demoparser) — быструю
Rust-биндинг-библиотеку для чтения CS2/CSGO демок из Python.

ВАЖНО про DemoParser.Exception: EntityNotFound
------------------------------------------------
Изначально round-номер брался через `parse_event(..., other=["total_rounds_played"])`
прямо на событиях player_death/player_hurt. На реальных демках это падало
с `EntityNotFound` — похоже, что запрос ЛЮБОГО доп. поля (даже "other",
не только "player") на этих событиях требует резолвить какую-то entity
(game rules и т.п.), которая не всегда валидна в момент события (ранний
warmup, world/бот-килы и т.д.), и в этой версии demoparser2 это не
деградирует в None, а роняет весь вызов.

Решение: события запрашиваются СОВСЕМ БЕЗ доп. полей (`player=`/`other=`),
берутся только нативные колонки события. Номер раунда для каждого события
определяем сами — по тику, попадающему в окно [начало_раунда; конец_раунда]
конкретного раунда (см. `_build_round_windows`/`_tick_to_round_num`).
team_num по раундам берём отдельным вызовом `parse_ticks(["team_num"],
ticks=...)` на тики round_end — это уже другой путь в библиотеке (не
event-based), и он такой проблемы не имеет.

ВАЖНО про варм-ап: демка пишет и предматчевые ножевые бои/гранаты (ещё до
первого настоящего раунда). Раньше номер раунда для события считался как
"сколько round_end уже прошло к этому тику" — а это ошибочно приписывало
ВСЁ, что было до конца раунда 1 (включая весь варм-ап), к раунду 1: килы,
смерти и особенно урон завышались (реальный кейс — ADR 172 вместо 105 на
FACEIT, у всех игроков команды было +1 к смертям от варм-апных руб).
Теперь строятся точные окна раунда через round_start+round_end по
одинаковому номеру раунда, и всё, что случилось ВНЕ всех окон — отбрасывается,
а не приписывается ближайшему раунду.

Если какой-то из базовых вызовов (player_death/player_hurt/round_start/
round_end) всё равно упадёт — исключение теперь явно называет, какой именно
вызов и с какой ошибкой, чтобы не гадать по трейсбеку.

ВАЖНО про "бонусные" статы (экономика, оружие, утилита, клатчи, стороны)
------------------------------------------------------------------------
Всё, что ниже базового набора (килы/смерти/ADR/KAST/раунды — то, что уже
проверено на реальных демках), считается из полей и событий, которых нет
в основном "must have" вызове player_death/player_hurt: часть колонок
(weapon-флаги вроде noscope/thrusmoke/penetrated/assistedflash/distance)
и часть событий (round_freeze_end, *_detonate) в разных версиях demoparser2
могут называться иначе или отсутствовать. Поэтому каждая такая фича обёрнута
в try/except и деградирует МОЛЧА В ЭТУ ФИЧУ (не роняя весь разбор демки) —
а причина складывается в "parse_warnings" в ответе, чтобы не гадать по логам,
а увидеть в самой сохранённой статистике матча, что именно не посчиталось.
"""

from __future__ import annotations

import bisect
import math
from collections import defaultdict
from dataclasses import dataclass, field

from demoparser2 import DemoParser

# 1 юнит движка Source ≈ 1/52.49 метра — общепринятая в CS-комьюнити оценка
# (используется для конвертации дистанции килов в метры; официальной
# документации Valve на этот счёт нет, это тоже эмпирическая константа).
UNITS_PER_METER = 52.49

UTILITY_DAMAGE_WEAPONS = {"hegrenade", "molotov", "incgrenade", "inferno"}

# Кандидаты названий событий/колонок различаются между версиями demoparser2 —
# пробуем по порядку, берём первое, что нашлось.
GRENADE_THROW_EVENTS = {
    "flash": ("flashbang_detonate",),
    "smoke": ("smokegrenade_detonate",),
    "he": ("hegrenade_detonate",),
    "molotov": ("inferno_startburn", "molotov_detonate"),
}
STEAMID_COL_CANDIDATES = ("user_steamid", "steamid", "attacker_steamid", "thrower_steamid")


@dataclass
class PlayerAgg:
    steam_id: str
    nickname: str
    demo_team: int | None = None  # 0 или 1 — условная группа из демки (см. docstring)
    rounds_played: int = 0
    kills: int = 0
    deaths: int = 0
    assists: int = 0
    headshots: int = 0
    damage: int = 0
    entry_kills: int = 0
    entry_deaths: int = 0
    clutches_won: int = 0
    clutches_played: int = 0
    kast_rounds: int = 0
    multi_kills: dict = field(default_factory=lambda: {"2k": 0, "3k": 0, "4k": 0, "5k": 0})
    # ---- новые "бонусные" статы ----
    kills_by_weapon: dict = field(default_factory=dict)
    wallbang_kills: int = 0
    noscope_kills: int = 0
    smoke_kills: int = 0
    flash_assists: int = 0
    kill_distances: list = field(default_factory=list)
    utility_damage: int = 0
    grenades_thrown: dict = field(default_factory=lambda: {"flash": 0, "smoke": 0, "he": 0, "molotov": 0})


class UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb


def _sid(value) -> str | None:
    """Нормализует steam_id к строке.

    Важный нюанс pandas: если в колонке (например assister_steamid) есть
    хоть один NaN вперемешку с числами, вся колонка апкастится в float64 —
    steamid 76561198000000001 превращается в 76561198000000001.0. Без этой
    нормализации "1" и "1.0" считались бы разными игроками (дублирующиеся
    записи с оторванной статистикой). Поэтому целые float всегда приводим
    к int перед тем, как превратить в строку.
    """
    if value is None:
        return None
    try:
        if isinstance(value, float):
            if math.isnan(value):
                return None
            if value.is_integer():
                value = int(value)
    except Exception:
        pass
    s = str(value).strip()
    return s if s and s.lower() != "none" else None


def _is_missing(value) -> bool:
    """NaN (float) — частый случай пропуска значения в pandas-колонках этой
    библиотеки (team_num, health и т.д. — см. докстринги ниже по файлу),
    а `value is None` его не ловит, т.к. NaN — это float, а не None."""
    return value is None or (isinstance(value, float) and math.isnan(value))


def _parse_event_safe(parser: DemoParser, name: str, **kwargs):
    """Оборачивает parser.parse_event, чтобы в случае падения было сразу
    видно, какой именно вызов и с какой ошибкой упал — вместо голого трейсбека
    в недра Rust-биндинга. Для ОБЯЗАТЕЛЬНЫХ событий (без которых разбор демки
    в принципе невозможен) — падение останавливает весь parse_demo."""
    try:
        return parser.parse_event(name, **kwargs)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"parse_event('{name}', {kwargs}) упал: {type(exc).__name__}: {exc}") from exc


def _try_parse_event_optional(parser: DemoParser, name: str):
    """Для ДОПОЛНИТЕЛЬНЫХ статов (экономика, гранаты и т.п.) — если события
    с таким именем нет в этой версии demoparser2/в этой демке, просто
    возвращаем (None, причина) вместо падения всего разбора. Причина
    складывается вызывающим кодом в parse_warnings."""
    try:
        df = parser.parse_event(name)
        return df, None
    except Exception as exc:  # noqa: BLE001
        return None, f"{name}: {type(exc).__name__}: {exc}"


def _build_round_windows(round_start_df, round_end_df) -> dict:
    """{номер_раунда: (тик_начала, тик_конца)} — только для раундов с
    подтверждённым концом (round_end.winner не пуст, фильтруется до вызова).

    ВАЖНО (реальный кейс — счёт схлопнулся до 1:0 на доигранном матче):
    номер "round" у событий round_start и round_end в demoparser2 НЕ
    совпадает 1:1 — сопоставление тика начала раунда по номеру раунда почти
    всегда давало start > end (round_start текущего номера физически
    относился к другому раунду), и окно раунда не строилось вообще —
    таких раундов "без окна" оказалось 21 из 22.

    Поэтому окна теперь строятся ТОЛЬКО по цепочке тиков round_end
    (отсортированных по номеру раунда): окно раунда N — это (конец раунда
    N-1; конец раунда N). round_start здесь вообще не участвует, кроме
    одного случая — начала самого первого раунда, где предыдущего
    round_end ещё нет, а без нижней границы туда как раньше протащит весь
    варм-ап. Для него берём тик ПОСЛЕДНЕГО события round_start, случившегося
    не позже конца первого раунда — это надёжно, т.к. не зависит от того,
    как именно проиндексирован номер раунда в этом событии.
    """
    end_by_round = {int(r): int(t) for r, t in zip(round_end_df["round"], round_end_df["tick"])}
    if not end_by_round:
        return {}

    sorted_rounds = sorted(end_by_round)
    first_end = end_by_round[sorted_rounds[0]]

    first_start = 0
    if round_start_df is not None and "tick" in round_start_df.columns and len(round_start_df) > 0:
        candidates = [int(t) for t in round_start_df["tick"] if int(t) <= first_end]
        if candidates:
            first_start = max(candidates)

    windows = {}
    prev_end = first_start
    for rnd in sorted_rounds:
        end = end_by_round[rnd]
        if prev_end <= end:
            windows[rnd] = (prev_end, end)
        prev_end = end
    return windows


def _tick_to_round_num(tick: int, sorted_windows: list):
    """sorted_windows: [(round_num, start, end), ...] отсортированный по start.
    Возвращает номер раунда, в чьё окно попадает тик, либо None — событие
    случилось вне всех известных окон (варм-ап, пауза, техничка) и должно
    быть отброшено, а не приписано соседнему раунду.
    """
    starts = [w[1] for w in sorted_windows]
    idx = bisect.bisect_right(starts, tick) - 1
    if idx < 0:
        return None
    round_num, start, end = sorted_windows[idx]
    return round_num if start <= tick <= end else None


def _build_round_team_map(parser: DemoParser, end_tick_by_round: dict) -> dict:
    """{номер_раунда: {steam_id: team_num}} на момент конца каждого раунда.

    Тик конца раунда выбран специально: на нём все 10 игроков ещё существуют
    как entity (даже мёртвые — команда/сторона не пропадает со смертью),
    поэтому это самый надёжный момент, чтобы снять team_num у всех разом,
    включая игроков без единого кила/урона в раунде.
    """
    if not end_tick_by_round:
        return {}

    ticks = sorted(set(end_tick_by_round.values()))
    try:
        team_df = parser.parse_ticks(["team_num"], ticks=ticks)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"parse_ticks(['team_num'], ...) упал: {type(exc).__name__}: {exc}") from exc

    if team_df is None or len(team_df) == 0:
        return {}

    steamid_col = next((c for c in ("steamid", "steam_id", "user_steamid") if c in team_df.columns), None)
    if steamid_col is None:
        raise ValueError(f"В ответе parse_ticks нет колонки со steam_id (колонки: {list(team_df.columns)})")

    tick_to_round = {t: r for r, t in end_tick_by_round.items()}

    # ВАЖНО (реальный кейс — крэш "cannot convert float NaN to integer" на
    # LAN-демке): team_num может не резолвиться для конкретного игрока ровно
    # на тике конца раунда — например, игрок в этот момент переподключается
    # (обрыв на LAN). В pandas это NaN (float), а НЕ None — проверка
    # "is None" такое не ловит и int(nan) падает. Такие строки пропускаем,
    # но не теряем раунд для игрока целиком: если для него уже есть team_num
    # из более раннего раунда — используем его (сторона между раундами не
    # меняется, кроме смены сторон на half-time, а тут это лишь один
    # пропущенный замер, не полноценная замена состава).
    round_team_map: dict = defaultdict(dict)
    last_known_team: dict[str, int] = {}
    for _, row in team_df.sort_values("tick").iterrows():
        rnd = tick_to_round.get(int(row["tick"]))
        sid = _sid(row[steamid_col])
        if rnd is None or sid is None:
            continue

        raw_team_num = row.get("team_num")
        if _is_missing(raw_team_num):
            if sid in last_known_team:
                round_team_map[rnd][sid] = last_known_team[sid]
            continue

        team_num = int(raw_team_num)
        round_team_map[rnd][sid] = team_num
        last_known_team[sid] = team_num

    return round_team_map


def _group_players_from_round_map(round_team_map: dict) -> dict:
    """Union-find: игроки, деляющие team_num в одном раунде, — одна команда."""
    uf = UnionFind()

    for team_of_round in round_team_map.values():
        by_team_num = defaultdict(list)
        for sid, team_num in team_of_round.items():
            by_team_num[team_num].append(sid)
        for sids in by_team_num.values():
            for sid in sids:
                uf.find(sid)  # регистрируем узел, даже если он один в группе
            for sid in sids[1:]:
                uf.union(sids[0], sid)

    roots = {}
    group_of = {}
    for sid in uf.parent:
        root = uf.find(sid)
        if root not in roots:
            roots[root] = len(roots)
        group_of[sid] = roots[root]
    return group_of


def _detect_tick_rate(parser: DemoParser) -> int:
    try:
        header = parser.parse_header()
        for key in ("tick_rate", "playback_ticks_per_second", "server_tick_rate"):
            if key in header and header[key]:
                return int(header[key])
    except Exception:
        pass
    return 64  # безопасный дефолт для большинства CS2/MM демок


def _buy_type(avg_equip_value):
    """Грубая, но общепринятая в CS-комьюнити классификация закупки по
    среднему current_equip_value на игрока команды. Официальных порогов от
    Valve нет — это эвристика, подобранная по типичным ценам обвесов/оружия."""
    if avg_equip_value is None:
        return None
    if avg_equip_value < 2000:
        return "eco"
    if avg_equip_value < 3500:
        return "force"
    return "full"


def parse_demo(file_path: str) -> dict:
    parser = DemoParser(file_path)
    warnings: list[str] = []

    header = {}
    try:
        header = parser.parse_header()
    except Exception:
        pass
    map_name = header.get("map_name", "unknown")

    tick_rate = _detect_tick_rate(parser)
    trade_window_ticks = tick_rate * 5  # 5-секундное окно на трейд — стандарт для KAST

    # Никаких доп. полей (player=/other=) на этих вызовах — см. docstring
    # файла про EntityNotFound. Только нативные колонки события.
    kills_df = _parse_event_safe(parser, "player_death")
    damage_df = _parse_event_safe(parser, "player_hurt")
    round_start_df = _parse_event_safe(parser, "round_start")
    round_end_df = _parse_event_safe(parser, "round_end")

    if kills_df is None or len(kills_df) == 0:
        raise ValueError("В демке не найдено ни одного события player_death — файл повреждён или не CS2/CSGO демка")
    if round_end_df is None or len(round_end_df) == 0:
        raise ValueError("В демке не найдено ни одного события round_end — не удалось определить раунды/счёт")

    # Самая первая строка round_end обычно техническая (round=0, winner=None,
    # tick в начале записи, до фактического старта матча) — не настоящий
    # сыгранный раунд, отбрасываем такие по признаку "нет победителя".
    if "winner" in round_end_df.columns:
        round_end_df = round_end_df[round_end_df["winner"].notna()]
    if round_end_df is None or len(round_end_df) == 0:
        raise ValueError("После фильтрации технических строк round_end не осталось ни одного завершённого раунда")

    round_windows = _build_round_windows(round_start_df, round_end_df)
    if not round_windows:
        raise ValueError("Не удалось построить окна раундов из round_start/round_end")

    # ---------- Исключаем ножевой раунд ----------
    # Реальный кейс: счёт 14:8 вместо настоящих 13:8 (матч должен был
    # закончиться на 13 победах). Ножевой раунд (для выбора стороны перед
    # стартом) в demoparser2 НИЧЕМ не отличается от обычного раунда по
    # reason (тоже t_killed/ct_killed) — отличить его можно только по
    # оружию: это единственный раунд, где АБСОЛЮТНО все килы сделаны ножом
    # (knife/knife_t/knife_butterfly/...). Раунд с обычным оружием, где кто-то
    # просто зарезал соперника ножом посреди игры, под это не попадёт — там
    # будут и другие килы другим оружием.
    _pre_sorted_windows = sorted(((r, s, e) for r, (s, e) in round_windows.items()), key=lambda w: w[1])
    knife_rounds = set()
    if "weapon" in kills_df.columns:
        _pre_kills = kills_df.copy()
        _pre_kills["rnd"] = _pre_kills["tick"].apply(lambda t: _tick_to_round_num(int(t), _pre_sorted_windows))
        for rnd, group in _pre_kills.dropna(subset=["rnd"]).groupby("rnd"):
            weapons = group["weapon"].astype(str)
            if len(weapons) > 0 and weapons.str.startswith("knife").all():
                knife_rounds.add(int(rnd))
    if knife_rounds:
        round_windows = {r: w for r, w in round_windows.items() if r not in knife_rounds}

    sorted_windows = sorted(((r, s, e) for r, (s, e) in round_windows.items()), key=lambda w: w[1])
    rounds_total = len(round_windows)
    end_tick_by_round = {r: e for r, (s, e) in round_windows.items()}
    start_tick_by_round = {r: s for r, (s, e) in round_windows.items()}

    round_team_map = _build_round_team_map(parser, end_tick_by_round)
    if not round_team_map:
        raise ValueError("Не удалось определить составы команд по раундам (round_team_map пуст)")

    group_of = _group_players_from_round_map(round_team_map)

    players: dict[str, PlayerAgg] = {}

    def get_player(steam_id, nickname):
        sid = _sid(steam_id)
        if sid is None:
            return None
        if sid not in players:
            players[sid] = PlayerAgg(steam_id=sid, nickname=nickname or "unknown", demo_team=group_of.get(sid))
        return players[sid]

    # ---------- Раунд для каждого события — по окну [начало;конец] раунда.
    # Событие вне всех окон (варм-ап, техпауза) получает None и отбрасывается,
    # а не приписывается ближайшему раунду (это и была причина завышенных
    # килов/смертей/ADR на варм-апе — см. docstring файла).
    kills_df = kills_df.copy()
    kills_df["rnd"] = kills_df["tick"].apply(lambda t: _tick_to_round_num(int(t), sorted_windows))
    kills_df = kills_df[kills_df["rnd"].notna()]
    kills_df["rnd"] = kills_df["rnd"].astype(int)

    # ---------- Урон (ADR), учитываем только урон по противнику ----------
    # ВАЖНО (реальный кейс — ADR 172 вместо ~105 на FACEIT): поле dmg_health
    # у demoparser2 на ДОБИВАЮЩЕМ ударе — это сырой урон оружия ДО капа по
    # факту оставшегося HP, а не реально потерянное здоровье (подтверждено
    # на реальной демке: AWP хедшот dmg_health=439, хотя больше ~100 HP
    # физически потерять нельзя). На несмертельных попаданиях поле верное,
    # проблема именно на килах. Поэтому реальный урон за удар считаем сами —
    # как разницу между последним известным HP жертвы и HP из колонки
    # "health" ПОСЛЕ этого удара (это просто фактическое состояние сущности
    # на момент события, тут capping не нужен — оно и так не может быть
    # отрицательным). HP сбрасываем на 100 в начале каждого раунда.
    if damage_df is not None and len(damage_df) > 0:
        damage_sorted = damage_df.sort_values("tick")
        last_health: dict[str, int] = {}
        health_round = None
        for _, row in damage_sorted.iterrows():
            rnd = _tick_to_round_num(int(row["tick"]), sorted_windows)
            if rnd is None:
                continue  # варм-ап/техпауза/ножевой раунд — не в счёт
            if rnd != health_round:
                last_health = {}  # новый раунд — все живые снова по 100 HP
                health_round = rnd

            attacker = _sid(row.get("attacker_steamid"))
            victim = _sid(row.get("user_steamid"))
            if attacker is None or victim is None:
                continue

            prev_health = last_health.get(victim, 100)
            raw_health = row.get("health")
            cur_health = prev_health if _is_missing(raw_health) else int(raw_health)
            real_damage = max(0, prev_health - cur_health)
            last_health[victim] = cur_health

            team_of_round = round_team_map.get(rnd, {})
            attacker_team = team_of_round.get(attacker)
            victim_team = team_of_round.get(victim)
            if attacker_team is not None and attacker_team == victim_team:
                continue  # тимдамаг (и самоурон — attacker==victim тоже сюда попадёт) не считаем

            p = get_player(attacker, row.get("attacker_name"))
            if p:
                p.damage += real_damage
                weapon = row.get("weapon")
                if weapon in UTILITY_DAMAGE_WEAPONS:
                    p.utility_damage += real_damage

    # ---------- Раунды: килы, ассисты, смерти, entry, трейды, клатчи, мультикилы ----------
    rounds_grouped = kills_df.groupby("rnd")
    round_top_killer: dict[int, dict] = {}  # rnd -> {"sid": steam_id, "kills": int} — для детальной таблицы раундов
    round_entry: dict[int, dict] = {}  # rnd -> {"killer_sid":..., "victim_sid":...}
    round_clutch: dict[int, dict] = {}  # rnd -> {"sid":..., "opponents": int, "won": bool}

    for rnd, round_kills in rounds_grouped:
        round_kills_sorted = round_kills.sort_values("tick")
        kills_this_round_by_killer = defaultdict(int)
        deaths_order = []  # (tick, victim_id, attacker_id)

        for _, row in round_kills_sorted.iterrows():
            victim = _sid(row.get("user_steamid"))
            attacker = _sid(row.get("attacker_steamid"))
            assister = _sid(row.get("assister_steamid"))
            tick = row.get("tick", 0)

            if victim:
                get_player(victim, row.get("user_name"))
                deaths_order.append((tick, victim, attacker))

            if attacker and attacker != victim:
                p = get_player(attacker, row.get("attacker_name"))
                p.kills += 1
                kills_this_round_by_killer[attacker] += 1
                if row.get("headshot"):
                    p.headshots += 1

                # ---- бонусные статы по оружию (см. докстринг про деградацию) ----
                weapon = row.get("weapon")
                if weapon:
                    p.kills_by_weapon[weapon] = p.kills_by_weapon.get(weapon, 0) + 1
                penetrated = row.get("penetrated")
                # NaN — частый "пропуск значения" в этой библиотеке (см.
                # _is_missing) и, в отличие от None/0, он ИСТИНЕН в Python
                # (bool(float('nan')) == True) — без явной проверки NaN здесь
                # засчитался бы как wallbang-кил.
                if not _is_missing(penetrated) and penetrated:
                    p.wallbang_kills += 1
                if row.get("noscope"):
                    p.noscope_kills += 1
                if row.get("thrusmoke"):
                    p.smoke_kills += 1
                dist = row.get("distance")
                if not _is_missing(dist):
                    p.kill_distances.append(float(dist))

            if assister:
                pa = get_player(assister, row.get("assister_name"))
                if pa:
                    pa.assists += 1
                    if row.get("assistedflash"):
                        pa.flash_assists += 1

            if victim:
                pv = get_player(victim, row.get("user_name"))
                pv.deaths += 1

        # Entry kill/death — первая смерть раунда
        if deaths_order:
            _, first_victim, first_attacker = deaths_order[0]
            if first_attacker:
                get_player(first_attacker, None).entry_kills += 1
            if first_victim:
                get_player(first_victim, None).entry_deaths += 1
            round_entry[rnd] = {"killer_sid": first_attacker, "victim_sid": first_victim}

        # Мультикилы — максимум килов одним игроком за раунд
        for killer, cnt in kills_this_round_by_killer.items():
            if cnt >= 2:
                key = f"{min(cnt, 5)}k"
                pk = get_player(killer, None)
                pk.multi_kills[key] = pk.multi_kills.get(key, 0) + 1

        # Лучший фраггер раунда — для детальной таблицы раундов на фронте
        if kills_this_round_by_killer:
            top_sid, top_cnt = max(kills_this_round_by_killer.items(), key=lambda kv: kv[1])
            round_top_killer[rnd] = {"sid": top_sid, "kills": top_cnt}

        # ---- KAST для этого раунда ----
        team_of_round = round_team_map.get(rnd, {})
        round_roster = set(team_of_round.keys()) or set(group_of.keys())

        killers = {a for _, _, a in deaths_order if a}
        assisters_this_round = {
            _sid(v) for v in round_kills_sorted.get("assister_steamid", []).tolist() if _sid(v)
        }
        dead_this_round = {v for _, v, _ in deaths_order}
        alive_at_end = round_roster - dead_this_round

        traded_victims = {
            v
            for i, (tick, v, a) in enumerate(deaths_order)
            if a
            for tick2, v2, a2 in deaths_order[i + 1 :]
            if tick2 - tick <= trade_window_ticks and v2 == a and group_of.get(a2) == group_of.get(v)
        }

        for sid in round_roster:
            p = get_player(sid, None)
            if not p:
                continue
            p.rounds_played += 1
            contributed = sid in killers or sid in assisters_this_round or sid in alive_at_end or sid in traded_victims
            if contributed:
                p.kast_rounds += 1

        # ---- Клатчи (1vX) ----
        team_members = defaultdict(set)
        for sid in round_roster:
            grp = group_of.get(sid)
            if grp is not None:
                team_members[grp].add(sid)

        alive = {sid: True for sid in round_roster}
        clutcher = None
        clutcher_team = None
        clutch_opponents = 0
        for tick, victim, attacker in deaths_order:
            if victim in alive:
                alive[victim] = False
            for team, members in team_members.items():
                alive_count = sum(1 for m in members if alive.get(m, True))
                other_alive = sum(
                    1 for t2, members2 in team_members.items() if t2 != team for m in members2 if alive.get(m, True)
                )
                if alive_count == 1 and other_alive >= 1 and clutcher is None:
                    lone = next((m for m in members if alive.get(m, True)), None)
                    if lone:
                        clutcher, clutcher_team, clutch_opponents = lone, team, other_alive

        if clutcher:
            still_alive_teams = {t for t, members in team_members.items() if any(alive.get(m, True) for m in members)}
            pc = get_player(clutcher, None)
            if pc:
                pc.clutches_played += 1
                won = clutcher_team in still_alive_teams and len(still_alive_teams) == 1
                if won:
                    pc.clutches_won += 1
                round_clutch[rnd] = {"sid": clutcher, "opponents": clutch_opponents, "won": won}

    # ---------- Бонус: гранаты (броски) ----------
    # Каждый тип гранаты — отдельное необязательное событие; если названия
    # событий/колонок в этой версии demoparser2 отличаются — просто
    # пропускаем эту гранату (см. докстринг файла про деградацию).
    for kind, event_names in GRENADE_THROW_EVENTS.items():
        df = None
        last_err = None
        for event_name in event_names:
            df, err = _try_parse_event_optional(parser, event_name)
            if df is not None and len(df) > 0:
                break
            last_err = err
        if df is None or len(df) == 0:
            if last_err:
                warnings.append(f"Броски гранат ({kind}) не посчитаны: {last_err}")
            continue

        sid_col = next((c for c in STEAMID_COL_CANDIDATES if c in df.columns), None)
        if sid_col is None:
            warnings.append(f"Броски гранат ({kind}): в событии нет колонки со steam_id, колонки: {list(df.columns)}")
            continue

        for _, row in df.iterrows():
            tick = row.get("tick")
            if _is_missing(tick) or _tick_to_round_num(int(tick), sorted_windows) is None:
                continue  # вне матчевых раундов (варм-ап и т.п.) — не считаем
            sid = _sid(row.get(sid_col))
            p = players.get(sid) if sid else None  # только реальные участники матча, не боты варм-апа
            if p:
                p.grenades_thrown[kind] = p.grenades_thrown.get(kind, 0) + 1

    # ---------- Бонус: экономика по раундам (закупка/тип бая) ----------
    economy_by_round: dict[int, dict] = {}
    try:
        freeze_end_df, freeze_err = _try_parse_event_optional(parser, "round_freeze_end")
        freeze_tick_by_round: dict[int, int] = {}
        if freeze_end_df is not None and "round" in freeze_end_df.columns and "tick" in freeze_end_df.columns:
            for _, row in freeze_end_df.iterrows():
                rnd = int(row["round"])
                if rnd in round_windows:
                    freeze_tick_by_round[rnd] = int(row["tick"])
        # Раунды без события round_freeze_end (не нашлось события вовсе,
        # либо конкретно для этого номера раунда) — приближаем: старт раунда
        # + типичное время на закупку (20 сек), не заходя за конец раунда.
        for rnd, (start, end) in round_windows.items():
            if rnd not in freeze_tick_by_round:
                approx = min(start + tick_rate * 20, end)
                freeze_tick_by_round[rnd] = approx
        if freeze_err:
            warnings.append(f"round_freeze_end не найдено, тайминг закупки приближённый: {freeze_err}")

        econ_ticks = sorted(set(freeze_tick_by_round.values()))
        econ_df = parser.parse_ticks(["current_equip_value"], ticks=econ_ticks)
        if econ_df is not None and len(econ_df) > 0:
            steamid_col = next((c for c in ("steamid", "steam_id", "user_steamid") if c in econ_df.columns), None)
            if steamid_col is None:
                raise ValueError(f"нет колонки со steam_id в ответе (колонки: {list(econ_df.columns)})")

            tick_to_round = {t: r for r, t in freeze_tick_by_round.items()}
            # group -> round -> [equip values]
            equip_by_group_round: dict[int, dict[int, list]] = defaultdict(lambda: defaultdict(list))
            for _, row in econ_df.iterrows():
                rnd = tick_to_round.get(int(row["tick"]))
                sid = _sid(row.get(steamid_col))
                if rnd is None or sid is None:
                    continue
                grp = group_of.get(sid)
                equip = row.get("current_equip_value")
                if grp is None or _is_missing(equip):
                    continue
                equip_by_group_round[grp][rnd].append(float(equip))

            for rnd in round_windows:
                avg_a = equip_by_group_round.get(0, {}).get(rnd)
                avg_b = equip_by_group_round.get(1, {}).get(rnd)
                avg_a = round(sum(avg_a) / len(avg_a)) if avg_a else None
                avg_b = round(sum(avg_b) / len(avg_b)) if avg_b else None
                economy_by_round[rnd] = {
                    "team_a_avg_equip": avg_a,
                    "team_a_buy_type": _buy_type(avg_a),
                    "team_b_avg_equip": avg_b,
                    "team_b_buy_type": _buy_type(avg_b),
                }
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"Экономика по раундам не посчитана: {type(exc).__name__}: {exc}")

    # ---------- Бонус: позиции килов ("карта килов" на фронте) ----------
    # На player_death напрямую координаты не запрашиваем (см. докстринг файла
    # про EntityNotFound на доп. полях этих событий) — вместо этого отдельным
    # parse_ticks(["X","Y"], ...) на тиках самих килов (тот же приём, что уже
    # отработал для team_num и current_equip_value) получаем позиции ВСЕХ
    # игроков на эти тики и берём из них атакующего и жертву. Даём в ответе
    # только координаты (без реального изображения карты — своей радар-графики
    # у нас нет, это уже отдельная фронтенд-задача рисовать точки/линии).
    kill_positions_by_round: dict[int, list] = defaultdict(list)
    try:
        kill_ticks = sorted(set(int(t) for t in kills_df["tick"]))
        pos_df = parser.parse_ticks(["X", "Y"], ticks=kill_ticks)
        if pos_df is not None and len(pos_df) > 0:
            steamid_col = next((c for c in ("steamid", "steam_id", "user_steamid") if c in pos_df.columns), None)
            if steamid_col is None:
                raise ValueError(f"нет колонки со steam_id в ответе (колонки: {list(pos_df.columns)})")

            pos_by_tick: dict[int, dict[str, tuple]] = defaultdict(dict)
            for _, row in pos_df.iterrows():
                sid = _sid(row.get(steamid_col))
                x, y = row.get("X"), row.get("Y")
                if sid is None or _is_missing(x) or _is_missing(y):
                    continue
                pos_by_tick[int(row["tick"])][sid] = (float(x), float(y))

            for _, row in kills_df.iterrows():
                tick = int(row["tick"])
                attacker = _sid(row.get("attacker_steamid"))
                victim = _sid(row.get("user_steamid"))
                if attacker is None or victim is None or attacker == victim:
                    continue
                pos = pos_by_tick.get(tick, {})
                a_pos, v_pos = pos.get(attacker), pos.get(victim)
                if not a_pos or not v_pos:
                    continue  # позиция не резолвилась на этот тик — пропускаем именно этот кил, не всё остальное
                rnd = int(row["rnd"])
                kill_positions_by_round[rnd].append(
                    {
                        "tick": tick,
                        "attacker_steam_id": attacker,
                        "attacker_nickname": players[attacker].nickname if attacker in players else "unknown",
                        "attacker_x": a_pos[0],
                        "attacker_y": a_pos[1],
                        "victim_steam_id": victim,
                        "victim_nickname": players[victim].nickname if victim in players else "unknown",
                        "victim_x": v_pos[0],
                        "victim_y": v_pos[1],
                        "weapon": row.get("weapon"),
                        "headshot": bool(row.get("headshot")) if not _is_missing(row.get("headshot")) else False,
                    }
                )
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"Карта килов не посчитана: {type(exc).__name__}: {exc}")

    # ---------- Счёт матча по группам 0/1 + подробный лог по раундам ----------
    # round_end.winner — строка 'CT'/'T' (сторона), а не число team_num.
    # Стандартный маппинг Source/CS: team_num 2 = T, team_num 3 = CT.
    TEAM_NUM_TO_SIDE = {2: "T", 3: "CT"}
    REASON_LABELS = {
        "t_killed": "Т-сторона уничтожена",
        "ct_killed": "CT-сторона уничтожена",
        "bomb_exploded": "Бомба взорвалась",
        "bomb_defused": "Бомба обезврежена",
        "time_ran_out": "Время вышло (победа CT)",
        "hostages_rescued": "Заложники спасены",
        "hostages_not_rescued": "Заложники не спасены",
        "target_saved": "Точка спасена",
        "target_bombed": "Точка взорвана",
    }

    group_score = {0: 0, 1: 0}
    rounds_log = []
    side_stats = {
        "team_a": {"T": {"rounds": 0, "wins": 0}, "CT": {"rounds": 0, "wins": 0}},
        "team_b": {"T": {"rounds": 0, "wins": 0}, "CT": {"rounds": 0, "wins": 0}},
    }
    economy_summary = {
        "team_a": {"eco": {"rounds": 0, "wins": 0}, "force": {"rounds": 0, "wins": 0}, "full": {"rounds": 0, "wins": 0}},
        "team_b": {"eco": {"rounds": 0, "wins": 0}, "force": {"rounds": 0, "wins": 0}, "full": {"rounds": 0, "wins": 0}},
    }

    if "winner" in round_end_df.columns:
        for _, row in round_end_df.sort_values("round").iterrows():
            rnd = int(row["round"])
            if rnd not in round_windows:
                continue  # не удалось построить окно для этого раунда (см. _build_round_windows) — пропускаем
            winner_side = row.get("winner")
            team_of_round = round_team_map.get(rnd, {})
            match_group = next(
                (group_of.get(sid) for sid, tn in team_of_round.items() if TEAM_NUM_TO_SIDE.get(tn) == winner_side),
                None,
            )
            if match_group is not None:
                group_score[match_group] = group_score.get(match_group, 0) + 1
            winner_label = "A" if match_group == 0 else "B" if match_group == 1 else None

            # Сторона (T/CT) каждой из наших команд A/B в этом раунде.
            side_of_group = {}
            for sid, tn in team_of_round.items():
                grp = group_of.get(sid)
                side = TEAM_NUM_TO_SIDE.get(tn)
                if grp is not None and side and grp not in side_of_group:
                    side_of_group[grp] = side
            team_a_side = side_of_group.get(0)
            team_b_side = side_of_group.get(1)

            for key, side in (("team_a", team_a_side), ("team_b", team_b_side)):
                if side in side_stats[key]:
                    side_stats[key][side]["rounds"] += 1
                    if winner_label == ("A" if key == "team_a" else "B"):
                        side_stats[key][side]["wins"] += 1

            econ = economy_by_round.get(rnd, {})
            for key, buy_field in (("team_a", "team_a_buy_type"), ("team_b", "team_b_buy_type")):
                buy_type = econ.get(buy_field)
                if buy_type in economy_summary[key]:
                    economy_summary[key][buy_type]["rounds"] += 1
                    if winner_label == ("A" if key == "team_a" else "B"):
                        economy_summary[key][buy_type]["wins"] += 1

            start_tick, end_tick = round_windows[rnd]
            top = round_top_killer.get(rnd)
            entry = round_entry.get(rnd)
            clutch = round_clutch.get(rnd)
            reason_raw = row.get("reason")

            rounds_log.append(
                {
                    "round": rnd,
                    "winner_side": winner_side,
                    "winner": winner_label,
                    "reason": REASON_LABELS.get(reason_raw, reason_raw),
                    "duration_sec": round((end_tick - start_tick) / tick_rate, 1) if tick_rate else None,
                    "score_a_after": group_score.get(0, 0),
                    "score_b_after": group_score.get(1, 0),
                    # ВАЖНО: nickname здесь — это "сырое" имя из самой демки (то,
                    # что demoparser2 отдаёт как имя игрока на момент события) —
                    # оно может НЕ совпадать с зарегистрированным в клубе ником
                    # (FACEIT-импорт, ручное переименование и т.п. — реальный
                    # кейс: в таблице составов ники из клубного реестра, а в
                    # журнале раундов — другие). demo-parser не знает о клубной
                    # базе игроков (это отдельный сервис без доступа к БД), но
                    # steam_id — универсальный ключ, поэтому дублируем его рядом
                    # с ником: бэкенд (matchProcessing.service.js), уже
                    # сматчивший каждого steam_id с клубным игроком, подменяет
                    # эти ники на канонические перед сохранением raw_stats.
                    "top_killer": (players[top["sid"]].nickname if top and top["sid"] in players else None),
                    "top_killer_steam_id": (top["sid"] if top and top["sid"] in players else None),
                    "top_killer_kills": (top["kills"] if top else None),
                    "entry_kill_by": (
                        players[entry["killer_sid"]].nickname
                        if entry and entry.get("killer_sid") in players
                        else None
                    ),
                    "entry_kill_by_steam_id": (
                        entry["killer_sid"] if entry and entry.get("killer_sid") in players else None
                    ),
                    "entry_death_of": (
                        players[entry["victim_sid"]].nickname
                        if entry and entry.get("victim_sid") in players
                        else None
                    ),
                    "entry_death_of_steam_id": (
                        entry["victim_sid"] if entry and entry.get("victim_sid") in players else None
                    ),
                    "clutch": (
                        {
                            "player": players[clutch["sid"]].nickname,
                            "steam_id": clutch["sid"],
                            "opponents": clutch["opponents"],
                            "won": clutch["won"],
                        }
                        if clutch and clutch.get("sid") in players
                        else None
                    ),
                    "team_a_side": team_a_side,
                    "team_b_side": team_b_side,
                    "kills": kill_positions_by_round.get(rnd, []),
                    **econ,
                }
            )

    match_duration_sec = None
    if sorted_windows:
        first_start = sorted_windows[0][1]
        last_end = sorted_windows[-1][2]
        if tick_rate:
            match_duration_sec = round((last_end - first_start) / tick_rate, 1)

    return {
        "map": map_name,
        "rounds_total": rounds_total,
        "team_a_score": group_score.get(0, 0),
        "team_b_score": group_score.get(1, 0),
        "tick_rate": tick_rate,
        "duration_sec": match_duration_sec,
        "server_name": header.get("server_name") or header.get("servername"),
        "rounds": rounds_log,
        "side_stats": side_stats,
        "economy_summary": economy_summary,
        "parse_warnings": warnings,
        "players": [
            {
                "steam_id": p.steam_id,
                "nickname": p.nickname,
                "side_majority": "A" if p.demo_team == 0 else "B",
                "rounds_played": p.rounds_played,
                "kills": p.kills,
                "deaths": p.deaths,
                "assists": p.assists,
                "headshots": p.headshots,
                "damage": p.damage,
                "entry_kills": p.entry_kills,
                "entry_deaths": p.entry_deaths,
                "clutches_won": p.clutches_won,
                "clutches_played": p.clutches_played,
                "kast_rounds": p.kast_rounds,
                "multi_kills": p.multi_kills,
                "kills_by_weapon": p.kills_by_weapon,
                "wallbang_kills": p.wallbang_kills,
                "noscope_kills": p.noscope_kills,
                "smoke_kills": p.smoke_kills,
                "flash_assists": p.flash_assists,
                "avg_kill_distance_m": (
                    round(sum(p.kill_distances) / len(p.kill_distances) / UNITS_PER_METER, 1)
                    if p.kill_distances
                    else None
                ),
                "utility_damage": p.utility_damage,
                "grenades_thrown": p.grenades_thrown,
            }
            for p in players.values()
        ],
    }
