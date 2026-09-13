CREATE TABLE IF NOT EXISTS map_veto_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  team_a TEXT NOT NULL,
  team_b TEXT NOT NULL,
  token_a TEXT NOT NULL UNIQUE,
  token_b TEXT NOT NULL UNIQUE,
  best_of INTEGER NOT NULL CHECK (best_of IN (1, 3)),
  first_team TEXT NOT NULL CHECK (first_team IN ('A', 'B')),
  maps JSONB NOT NULL,
  actions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
