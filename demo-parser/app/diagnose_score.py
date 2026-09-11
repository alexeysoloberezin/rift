"""
Диагностика подсчёта СЧЁТА матча — отдельно от diagnose.py, потому что
проблема "счёт 1:0 на явно доигранном матче" при этом килы/смерти/ADR
уже посчитаны верно (см. предыдущий фикс варм-апа) означает, что ломается
именно team_num-цепочка (round_team_map / group_of), а не базовый парсинг
событий. Этот скрипт повторяет ТУ ЖЕ логику, что и app/parser.py, но с
подробной печатью по каждому раунду — чтобы увидеть, на каком именно шаге
и почему раунд перестаёт засчитываться нужной команде.

Использование:
  docker compose exec demo-parser python3 app/diagnose_score.py /app/uploads/demos/ИМЯ_ФАЙЛА.dem
"""

import sys

from demoparser2 import DemoParser

from parser import (
    _build_round_team_map,
    _build_round_windows,
    _group_players_from_round_map,
    _parse_event_safe,
    _sid,
)


def main():
    if len(sys.argv) < 2:
        print("Использование: python3 app/diagnose_score.py <путь_к_демке.dem>")
        sys.exit(1)

    path = sys.argv[1]
    parser = DemoParser(path)

    round_start_df = _parse_event_safe(parser, "round_start")
    round_end_df = _parse_event_safe(parser, "round_end")

    print(f"round_start_df: shape={round_start_df.shape if round_start_df is not None else None}, "
          f"columns={list(round_start_df.columns) if round_start_df is not None else None}")
    print(f"round_end_df (до фильтрации): shape={round_end_df.shape}, columns={list(round_end_df.columns)}")

    if "winner" in round_end_df.columns:
        round_end_df = round_end_df[round_end_df["winner"].notna()]
    print(f"round_end_df (после фильтра winner.notna()): shape={round_end_df.shape}")
    print("\nВСЕ строки round_end (round, tick, winner, reason):")
    cols = [c for c in ("round", "tick", "winner", "reason") if c in round_end_df.columns]
    print(round_end_df[cols].to_string())

    round_windows = _build_round_windows(round_start_df, round_end_df)
    print(f"\nПостроено окон раундов: {len(round_windows)} из {len(round_end_df)} строк round_end")
    missing_windows = sorted(set(int(r) for r in round_end_df["round"]) - set(round_windows.keys()))
    if missing_windows:
        print(f"РАУНДЫ БЕЗ ОКНА (отброшены на этом шаге, счёт по ним НЕ пойдёт): {missing_windows}")

    end_tick_by_round = {r: e for r, (s, e) in round_windows.items()}
    unique_end_ticks = sorted(set(end_tick_by_round.values()))
    print(f"\nУникальных end_tick для parse_ticks: {len(unique_end_ticks)} "
          f"(должно быть примерно равно числу раундов — если сильно меньше, вот и причина)")

    round_team_map = _build_round_team_map(parser, end_tick_by_round)
    print(f"\nround_team_map заполнен для {len(round_team_map)} раундов из {len(round_windows)}")
    empty_or_partial = [
        (r, len(round_team_map.get(r, {}))) for r in sorted(round_windows) if len(round_team_map.get(r, {})) < 10
    ]
    if empty_or_partial:
        print("Раунды, где team_of_round НЕ содержит все 10 игроков (rnd, кол-во игроков):")
        print(empty_or_partial)

    group_of = _group_players_from_round_map(round_team_map)
    groups = {}
    for sid, g in group_of.items():
        groups.setdefault(g, []).append(sid)
    print(f"\ngroup_of: найдено групп (команд) = {len(groups)}")
    for g, sids in groups.items():
        print(f"  группа {g}: {len(sids)} игроков -> {sids}")

    TEAM_NUM_TO_SIDE = {2: "T", 3: "CT"}
    group_score = {0: 0, 1: 0}
    print("\nПошаговый разбор счёта по раундам:")
    for _, row in round_end_df.iterrows():
        rnd = int(row["round"])
        if rnd not in round_windows:
            print(f"  раунд {rnd}: НЕТ окна -> пропущен")
            continue
        winner_side = row.get("winner")
        team_of_round = round_team_map.get(rnd, {})
        match_group = next(
            (group_of.get(sid) for sid, tn in team_of_round.items() if TEAM_NUM_TO_SIDE.get(tn) == winner_side),
            None,
        )
        if match_group is None:
            print(f"  раунд {rnd}: winner_side={winner_side!r}, team_of_round игроков={len(team_of_round)} "
                  f"-> НЕ ЗАСЧИТАН (match_group=None)")
        else:
            group_score[match_group] = group_score.get(match_group, 0) + 1
            print(f"  раунд {rnd}: winner_side={winner_side!r} -> засчитан группе {match_group} "
                  f"(текущий счёт: {group_score})")

    print(f"\nИТОГОВЫЙ СЧЁТ: группа 0 = {group_score.get(0, 0)}, группа 1 = {group_score.get(1, 0)}")
    print("Скопируйте весь вывод целиком.")


if __name__ == "__main__":
    main()
