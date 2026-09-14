-- RIFT — схема базы данных (PostgreSQL)
-- Своя локальная БД, без внешних SaaS-зависимостей.

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- для gen_random_uuid()

-- ===================== АДМИНЫ =====================
CREATE TABLE admins (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin', -- admin | superadmin
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== ИГРОКИ (глобальный профиль клуба) =====================
CREATE TABLE players (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nickname        TEXT NOT NULL,
    real_name       TEXT,
    telegram        TEXT,
    steam_id64      TEXT UNIQUE,
    faceit_link     TEXT,
    faceit_nickname TEXT,
    avatar_url      TEXT,
    country         TEXT,
    -- внутренний рейтинг клуба RIFT (аналог ELO), меняется по итогам матчей с демками
    rating          NUMERIC(8,2) NOT NULL DEFAULT 1000.00,
    matches_played  INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_players_nickname ON players (LOWER(nickname));

-- ===================== ТУРНИРЫ =====================
CREATE TABLE tournaments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    description  TEXT,
    status       TEXT NOT NULL DEFAULT 'draft', -- draft | registration | active | finished
    format       TEXT,                          -- произвольное описание формата (BO1/BO3, группы+плей-офф и т.п.)
    start_date   DATE,
    end_date     DATE,
    created_by   UUID REFERENCES admins(id),
    mvp_player_id UUID REFERENCES players(id) ON DELETE SET NULL,

    -- Автосинк списка игроков из живой Google-таблицы (вместо разового
    -- импорта .xlsx) — см. backend/src/services/googleSheets.service.js.
    sheet_id              TEXT,               -- ID таблицы из её URL
    sheet_range           TEXT DEFAULT 'A:Z', -- диапазон в A1-нотации, напр. "Лист1!A:Z"
    sheet_sync_enabled    BOOLEAN NOT NULL DEFAULT false,
    sheet_last_synced_at  TIMESTAMPTZ,
    sheet_last_sync_error TEXT,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Игрок в контексте конкретного турнира: то, что приходит из Excel при импорте
-- (сохраняем сырую строку целиком в raw_row, чтобы не терять исходные данные оргов)
CREATE TABLE tournament_players (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    seed_rating     NUMERIC(8,2),   -- рейтинг/эло на момент регистрации (из Excel, напр. faceit elo)
    hours_cs2       NUMERIC(8,1),   -- часы в игре (из Excel)
    raw_row         JSONB,          -- вся строка из Excel как есть
    imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, player_id)
);

-- ===================== КОМАНДЫ =====================
CREATE TABLE teams (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    tag           TEXT,
    logo_url      TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_players (
    team_id   UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    is_captain BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (team_id, player_id)
);

-- ===================== МАТЧИ =====================
CREATE TABLE matches (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_a_id     UUID REFERENCES teams(id),
    team_b_id     UUID REFERENCES teams(id),
    map           TEXT,                    -- de_mirage, de_inferno, ...
    best_of       INTEGER DEFAULT 1,
    score_a       INTEGER,
    score_b       INTEGER,
    status        TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | played | needs_demo | rated
    played_at     TIMESTAMPTZ,
    round_number  TEXT,                    -- напр. "Группа A, тур 2" или "1/4 финала"
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== ДЕМКИ =====================
CREATE TABLE demos (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id       UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    original_name  TEXT,
    storage_path   TEXT NOT NULL,   -- путь к .dem на диске сервера
    status         TEXT NOT NULL DEFAULT 'pending', -- pending | parsing | parsed | error
    error_message  TEXT,
    uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    parsed_at      TIMESTAMPTZ,
    raw_stats      JSONB            -- сырой ответ demo-parser сервиса (на всякий случай, для дебага/пересчёта)
);

-- ===================== СТАТИСТИКА ИГРОКА ЗА МАТЧ =====================
CREATE TABLE match_player_stats (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    team_id         UUID REFERENCES teams(id),

    rounds_played   INTEGER NOT NULL DEFAULT 0,
    kills           INTEGER NOT NULL DEFAULT 0,
    deaths          INTEGER NOT NULL DEFAULT 0,
    assists         INTEGER NOT NULL DEFAULT 0,
    headshots       INTEGER NOT NULL DEFAULT 0,
    damage          INTEGER NOT NULL DEFAULT 0,     -- суммарный урон по игрокам
    adr             NUMERIC(6,2),                   -- damage / rounds_played
    kast_rounds     INTEGER NOT NULL DEFAULT 0,     -- кол-во раундов, засчитанных в KAST
    kast_pct        NUMERIC(5,2),                   -- kast_rounds / rounds_played * 100
    entry_kills     INTEGER NOT NULL DEFAULT 0,
    entry_deaths    INTEGER NOT NULL DEFAULT 0,
    clutches_won    INTEGER NOT NULL DEFAULT 0,
    clutches_played INTEGER NOT NULL DEFAULT 0,
    multi_kills     JSONB,                          -- {"2k":x,"3k":y,"4k":z,"5k":w}

    match_rating    NUMERIC(6,3),   -- перфоманс-рейтинг за матч (HLTV2.0-подобный)
    elo_before      NUMERIC(8,2),
    elo_after       NUMERIC(8,2),
    elo_change      NUMERIC(8,2),   -- "swing" — на сколько изменился общий рейтинг игрока

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (match_id, player_id)
);

-- История изменения общего рейтинга — для графиков динамики игрока
CREATE TABLE player_rating_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    match_id    UUID REFERENCES matches(id) ON DELETE SET NULL,
    elo_before  NUMERIC(8,2) NOT NULL,
    elo_after   NUMERIC(8,2) NOT NULL,
    elo_change  NUMERIC(8,2) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Один матч не должен давать игроку больше одной строки истории рейтинга —
-- иначе переобработка того же матча (перезалив исправленной демки и т.п.)
-- задваивает историю. NULL в match_id (после удаления матча) под это
-- ограничение не подпадает — в Postgres NULL != NULL, что здесь и нужно.
CREATE UNIQUE INDEX idx_rating_history_unique_match ON player_rating_history (player_id, match_id) WHERE match_id IS NOT NULL;

CREATE INDEX idx_mps_player ON match_player_stats (player_id);
CREATE INDEX idx_mps_match ON match_player_stats (match_id);
CREATE INDEX idx_rating_history_player ON player_rating_history (player_id, created_at);
CREATE INDEX idx_matches_tournament ON matches (tournament_id);
CREATE INDEX idx_demos_match ON demos (match_id);
