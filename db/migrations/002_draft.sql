-- Драфт капитанов ("змейка"): админ задаёт число команд N, топ-N игроков
-- турнира по seed elo автоматически становятся капитанами и получают
-- команды, у каждого капитана — приватная ссылка (pick_token) для пиков без
-- логина. Порядок пиков — классический snake draft: капитаны упорядочены по
-- seed elo ВОЗРАСТАНИЕМ (слабейший капитан пикает первым в каждом нечётном
-- раунде — это балансирует составы), каждый следующий раунд идёт в обратном
-- направлении. Сама очередь НЕ хранится как список — вычисляется на лету по
-- количеству уже сделанных пиков (см. draft.service.js getTurnTeamIndex) —
-- так на дольше не может рассинхронизироваться с фактическими pick-строками.
--
-- Реальный состав команды живёт в уже существующей team_players (капитан
-- добавляется туда сразу при старте драфта с is_captain=true, каждый пик —
-- обычный INSERT в team_players) — так драфт остаётся полностью совместим со
-- всем остальным приложением (группы/сетка/матчи просто видят готовые
-- команды). draft_picks — это отдельный лог именно ХОДА драфта (кто, когда,
-- каким по счёту пиком), не замена team_players.
--
-- Написано идемпотентно (IF NOT EXISTS) — безопасно перезапускать миграцию
-- на уже накаченной базе, см. backend/src/scripts/migrate.js.

CREATE TABLE IF NOT EXISTS drafts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Один турнир — один (последний) драфт: если админ сбросит драфт и
    -- запустит заново, старая строка удаляется целиком (см. draft.routes.js
    -- DELETE .../draft), а не архивируется — истории прошлых драфтов не
    -- держим, это разметка формирования составов, а не спортивный результат.
    tournament_id      UUID NOT NULL UNIQUE REFERENCES tournaments(id) ON DELETE CASCADE,
    teams_count        INTEGER NOT NULL CHECK (teams_count >= 2),
    status             TEXT NOT NULL DEFAULT 'active', -- active | finished
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS draft_teams (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id     UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    captain_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    -- 0 = капитан с наименьшим seed elo среди капитанов -> пикает первым.
    seed_order   INTEGER NOT NULL,
    -- Секрет в ссылке капитана (/draft/:token на фронте) — доступ без
    -- логина, поэтому это длинный случайный токен, а не UUID команды/id.
    pick_token   TEXT NOT NULL UNIQUE,
    UNIQUE (draft_id, team_id),
    UNIQUE (draft_id, seed_order)
);

CREATE TABLE IF NOT EXISTS draft_picks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id    UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    -- Порядковый номер пика в этом драфте (0-based) — фиксирует историю even
    -- если позже поменяется состав пула (для отображения/отладки хода).
    pick_index  INTEGER NOT NULL,
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    picked_by   TEXT NOT NULL DEFAULT 'captain', -- captain | admin (админ пикнул за капитана вручную)
    picked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (draft_id, pick_index),
    UNIQUE (draft_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_draft_teams_draft ON draft_teams (draft_id);
CREATE INDEX IF NOT EXISTS idx_draft_picks_draft ON draft_picks (draft_id);
