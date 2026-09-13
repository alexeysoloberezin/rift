-- CSV exports may lack round-level metrics; unknown values are not zero.
ALTER TABLE match_player_stats ALTER COLUMN rounds_played DROP NOT NULL;
ALTER TABLE match_player_stats ALTER COLUMN kast_rounds DROP NOT NULL;
ALTER TABLE match_player_stats ALTER COLUMN entry_kills DROP NOT NULL;
ALTER TABLE match_player_stats ALTER COLUMN entry_deaths DROP NOT NULL;
ALTER TABLE match_player_stats ALTER COLUMN clutches_won DROP NOT NULL;
ALTER TABLE match_player_stats ALTER COLUMN clutches_played DROP NOT NULL;
