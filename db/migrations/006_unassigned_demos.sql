ALTER TABLE demos ALTER COLUMN match_id DROP NOT NULL;
ALTER TABLE demos ADD COLUMN IF NOT EXISTS tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE;
UPDATE demos d SET tournament_id = m.tournament_id FROM matches m
WHERE d.match_id = m.id AND d.tournament_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_demos_available ON demos (tournament_id, uploaded_at DESC) WHERE match_id IS NULL;
