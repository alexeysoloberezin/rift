CREATE TABLE IF NOT EXISTS match_screenshots (
  match_id UUID PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  content BYTEA NOT NULL,
  content_type TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_manually_set BOOLEAN NOT NULL DEFAULT false;
