ALTER TABLE teams ADD COLUMN IF NOT EXISTS captain_name TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS teams_tournament_captain_name_unique
ON teams (tournament_id, LOWER(BTRIM(captain_name)))
WHERE captain_name IS NOT NULL AND BTRIM(captain_name) <> '';
