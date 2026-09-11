"""
Ручная диагностика demoparser2 на конкретном .dem файле — НЕ часть API,
запускается вручную внутри контейнера demo-parser, когда parse_demo() падает
и непонятно, на чём именно. Ничего не предполагает заранее — просто пробует
самые базовые вызовы по одному и печатает, что конкретно сломалось и какие
колонки реально возвращает библиотека.

Использование:
  docker compose exec demo-parser python3 app/diagnose.py /app/uploads/demos/ИМЯ_ФАЙЛА.dem
"""

import sys
import traceback

from demoparser2 import DemoParser


def header(title):
    print(f"\n{'=' * 10} {title} {'=' * 10}")


def try_call(title, fn):
    header(title)
    try:
        result = fn()
        print("OK")
        return result
    except Exception as exc:  # noqa: BLE001
        print(f"УПАЛО: {type(exc).__name__}: {exc}")
        traceback.print_exc()
        return None


def main():
    if len(sys.argv) < 2:
        print("Использование: python3 app/diagnose.py <путь_к_демке.dem>")
        sys.exit(1)

    path = sys.argv[1]
    print(f"Файл: {path}")

    try:
        import demoparser2

        version = getattr(demoparser2, "__version__", None)
        if not version:
            try:
                from importlib.metadata import version as pkg_version

                version = pkg_version("demoparser2")
            except Exception:
                version = "не удалось определить"
        print(f"demoparser2 version: {version}")
    except Exception as exc:
        print(f"Не удалось прочитать версию demoparser2: {exc}")

    parser = DemoParser(path)

    header_data = try_call("parse_header()", lambda: parser.parse_header())
    if header_data:
        print(header_data)

    df = try_call("parse_event('round_end') — совсем без доп. полей", lambda: parser.parse_event("round_end"))
    if df is not None:
        print("shape:", df.shape)
        print("columns:", list(df.columns))
        print(df.head(3).to_string())

    df = try_call(
        "parse_event('round_start') — совсем без доп. полей", lambda: parser.parse_event("round_start")
    )
    if df is not None:
        print("shape:", df.shape)
        print("columns:", list(df.columns))

    df = try_call("parse_event('player_death') — совсем без доп. полей", lambda: parser.parse_event("player_death"))
    if df is not None:
        print("shape:", df.shape)
        print("columns:", list(df.columns))
        print(df.head(10).to_string())
        # Проверим, есть ли строки с нестандартным attacker (world/bomb/суицид) —
        # частая причина EntityNotFound в некоторых версиях demoparser2.
        if "attacker_name" in df.columns:
            weird = df[df["attacker_steamid"].isna()] if "attacker_steamid" in df.columns else None
            if weird is not None and len(weird) > 0:
                print(f"\nСтрок с пустым attacker_steamid (world/суицид/бомба): {len(weird)}")
                print(weird.head(10).to_string())

    df = try_call("parse_event('player_hurt') — совсем без доп. полей", lambda: parser.parse_event("player_hurt"))
    if df is not None:
        print("shape:", df.shape)
        print("columns:", list(df.columns))

    df = try_call(
        "parse_ticks(['team_num'], ticks=[100]) — на одном произвольном тике",
        lambda: parser.parse_ticks(["team_num"], ticks=[100]),
    )
    if df is not None:
        print("shape:", df.shape)
        print("columns:", list(df.columns))
        print(df.head(10).to_string())

    header("Готово")
    print("Скопируйте весь вывод выше — по нему будет понятно, что чинить.")


if __name__ == "__main__":
    main()
