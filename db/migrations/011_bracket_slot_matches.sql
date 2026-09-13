-- A playoff meeting is a series and can contain several map matches.
CREATE TABLE IF NOT EXISTS bracket_slot_matches (
  slot_id UUID NOT NULL REFERENCES bracket_slots(id) ON DELETE CASCADE,
  match_id UUID NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (slot_id, match_id)
);
INSERT INTO bracket_slot_matches (slot_id, match_id)
SELECT id, match_id FROM bracket_slots WHERE match_id IS NOT NULL
ON CONFLICT (match_id) DO NOTHING;
CREATE INDEX IF NOT EXISTS idx_bracket_slot_matches_slot ON bracket_slot_matches (slot_id, created_at);
