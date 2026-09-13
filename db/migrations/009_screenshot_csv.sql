-- Screenshots show rounded ADR, which cannot reconstruct exact total damage.
ALTER TABLE match_player_stats ALTER COLUMN damage DROP NOT NULL;
