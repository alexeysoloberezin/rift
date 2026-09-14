-- Один профиль может играть в демках под другим Steam-ником. Псевдонимы
-- турнирные: это не меняет основной ник игрока в клубном профиле.
ALTER TABLE tournament_players
  ADD COLUMN IF NOT EXISTS demo_aliases TEXT[] NOT NULL DEFAULT '{}'::text[];
