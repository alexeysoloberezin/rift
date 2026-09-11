-- Групповой этап (ровно 2 группы на турнир) и плей-офф сетка
-- (полуфинал: 2 матча / 4 команды -> финал: 1 матч / 2 команды).
--
-- Обе фичи — это только "разметка": админ вручную распределяет команды по
-- группам/слотам сетки и отдельно привязывает уже загруженный и обработанный
-- матч как результат встречи. Никакой автоматики (авто-посев по рейтингу,
-- авто-проброс победителя полуфинала в финал) сознательно нет — так проще и
-- предсказуемее для организатора любительского турнира, который принимает
-- эти решения руками, а не по формуле.
--
-- Написано так, чтобы можно было безопасно перезапустить на базе, где схема
-- уже накатана (IF NOT EXISTS/ON CONFLICT) — см. backend/src/scripts/migrate.js.

-- ===================== ГРУППЫ =====================
CREATE TABLE IF NOT EXISTS groups (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,     -- "Группа A" / "Группа B" — админ может переименовать
    slot          INTEGER NOT NULL,  -- 1 | 2 — ровно 2 группы на турнир; слот фиксирует порядок отображения
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT groups_slot_check CHECK (slot IN (1, 2)),
    CONSTRAINT groups_tournament_slot_unique UNIQUE (tournament_id, slot)
);

-- Команда в группе турнира. PRIMARY KEY стоит на team_id (а не на паре
-- group_id+team_id) — этим и обеспечивается "команда состоит максимум в
-- одной группе": переназначение команды в другую группу — это UPDATE
-- существующей строки через ON CONFLICT (см. groups.routes.js), а не второй
-- INSERT рядом со старым.
CREATE TABLE IF NOT EXISTS group_teams (
    team_id    UUID PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
    group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_teams_group ON group_teams (group_id);

-- Явная привязка матча к группе — так результаты группового этапа не
-- путаются с матчем той же пары команд на плей-офф (там group_id остаётся
-- NULL). Заполняется админом при создании/редактировании матча.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE SET NULL;

-- ===================== ПЛЕЙ-ОФФ СЕТКА =====================
-- Фиксированная форма на турнир: полуфинал (2 матча, slot_index 0/1) ->
-- финал (1 матч, slot_index 0). Слоты создаются один раз через
-- POST .../bracket/init (см. bracket.routes.js) и дальше только
-- редактируются — новые раунды/слоты этой схемой не предусмотрены.
CREATE TABLE IF NOT EXISTS bracket_slots (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    round         TEXT NOT NULL,     -- semifinal | final
    slot_index    INTEGER NOT NULL,
    team_a_id     UUID REFERENCES teams(id) ON DELETE SET NULL,
    team_b_id     UUID REFERENCES teams(id) ON DELETE SET NULL,
    match_id      UUID REFERENCES matches(id) ON DELETE SET NULL, -- привязанный матч-результат встречи
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT bracket_slots_round_check CHECK (round IN ('semifinal', 'final')),
    CONSTRAINT bracket_slots_slot_index_check CHECK (
      (round = 'semifinal' AND slot_index IN (0, 1)) OR (round = 'final' AND slot_index = 0)
    ),
    CONSTRAINT bracket_slots_unique UNIQUE (tournament_id, round, slot_index)
);
