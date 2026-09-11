"""
Диагностика ADR + подозрения на "лишний" раунд (нож/рестарт) — отдельно от
diagnose_score.py. Печатает:
  1. Оружие в килах раунда 1 (проверить гипотезу "это ножевой раунд, который
     не должен идти в счёт/статистику").
  2. Все сырые события урона (player_hurt) от указанного игрока (по нику,
     без учёта регистра) — тик, raw-колонки как они есть у demoparser2,
     округлённо посчитанный по ним раунд. Нужно увидеть, dmg_health — это
     урон ЗА ЭТОТ конкретный удар (дельта) или что-то накопительное — если
     накопительное, а мы суммируем построчно как дельту, ADR будет расти
     снежным комом.
  3. Независимый пересчёт суммарного урона этого игрока по формуле
     "как должно быть" (сумма dmg_health по всем его hurt-событиям, без
     тимдамага, в пределах окон раундов) — для сравнения с тем, что сейчас
     выводит parse_demo().

Использование:
  docker compose exec demo-parser python3 app/diagnose_adr.py /app/uploads/demos/ИМЯ_ФАЙЛА.dem "BabyAceX"
"""

import sys

from demoparser2 import DemoParser

from parser import _build_round_windows, _parse_event_safe, _sid, _tick_to_round_num, _build_round_team_map


def main():
    if len(sys.argv) < 3:
        print('Использование: python3 app/diagnose_adr.py <путь_к_демке.dem> "<ник_игрока>"')
        sys.exit(1)

    path = sys.argv[1]
    nickname = sys.argv[2].strip().lower()

    parser = DemoParser(path)

    kills_df = _parse_event_safe(parser, "player_death")
    damage_df = _parse_event_safe(parser, "player_hurt")
    round_start_df = _parse_event_safe(parser, "round_start")
    round_end_df = _parse_event_safe(parser, "round_end")
    if "winner" in round_end_df.columns:
        round_end_df = round_end_df[round_end_df["winner"].notna()]

    round_windows = _build_round_windows(round_start_df, round_end_df)
    sorted_windows = sorted(((r, s, e) for r, (s, e) in round_windows.items()), key=lambda w: w[1])
    end_tick_by_round = {r: e for r, (s, e) in round_windows.items()}
    round_team_map = _build_round_team_map(parser, end_tick_by_round)

    print("=" * 10, "Килы раунда 1 (проверка на ножевой раунд)", "=" * 10)
    print("Колонки kills_df:", list(kills_df.columns))
    r1_start, r1_end = round_windows.get(1, (None, None))
    print(f"Окно раунда 1: [{r1_start}; {r1_end}]")
    if r1_start is not None:
        r1_kills = kills_df[(kills_df["tick"] >= r1_start) & (kills_df["tick"] <= r1_end)]
        weapon_col = next((c for c in ("weapon", "weapon_name") if c in r1_kills.columns), None)
        cols = [c for c in ("tick", "attacker_name", "user_name", weapon_col, "headshot") if c and c in r1_kills.columns]
        print(r1_kills[cols].to_string())

    print("\n" + "=" * 10, f"Урон от игрока '{nickname}'", "=" * 10)
    print("Колонки damage_df:", list(damage_df.columns))
    name_col = next((c for c in ("attacker_name",) if c in damage_df.columns), None)
    mine = damage_df[damage_df[name_col].astype(str).str.strip().str.lower() == nickname] if name_col else damage_df.iloc[0:0]
    print(f"Найдено событий player_hurt с attacker_name == '{nickname}': {len(mine)}")

    show_cols = [
        c
        for c in ("tick", "attacker_name", "user_name", "dmg_health", "dmg_armor", "health", "armor", "weapon", "hitgroup")
        if c in mine.columns
    ]
    mine_sorted = mine.sort_values("tick")
    print("\nВСЕ строки урона от этого игрока (как есть, без фильтрации тимдамага):")
    print(mine_sorted[show_cols].to_string())

    print("\n" + "=" * 10, "Независимый пересчёт (без тимдамага, только внутри окон раундов)", "=" * 10)
    total = 0
    per_round = {}
    for _, row in mine_sorted.iterrows():
        rnd = _tick_to_round_num(int(row["tick"]), sorted_windows)
        if rnd is None:
            print(f"  тик {row['tick']}: вне всех окон раундов -> пропущен")
            continue
        attacker = _sid(row.get("attacker_steamid")) if "attacker_steamid" in mine.columns else None
        victim = _sid(row.get("user_steamid")) if "user_steamid" in mine.columns else None
        team_of_round = round_team_map.get(rnd, {})
        attacker_team = team_of_round.get(attacker) if attacker else None
        victim_team = team_of_round.get(victim) if victim else None
        dmg = int(row.get("dmg_health", 0) or 0)
        if attacker_team is not None and attacker_team == victim_team:
            print(f"  раунд {rnd}, тик {row['tick']}: тимдамаг {dmg} -> исключён")
            continue
        total += dmg
        per_round[rnd] = per_round.get(rnd, 0) + dmg
        print(f"  раунд {rnd}, тик {row['tick']}: +{dmg} (по victim={victim})")

    rounds_played = len(round_windows)
    print(f"\nСуммарный урон (пересчитано здесь): {total}")
    print(f"Раундов всего: {rounds_played}")
    print(f"ADR (пересчитано здесь): {round(total / rounds_played, 2) if rounds_played else 0}")
    print("\nПо раундам:", per_round)


if __name__ == "__main__":
    main()
