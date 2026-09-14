-- MVP назначает организатор турнира. При удалении глобального профиля выбор
-- сбрасывается, а сам турнир остаётся доступен.
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS mvp_player_id UUID REFERENCES players(id) ON DELETE SET NULL;
