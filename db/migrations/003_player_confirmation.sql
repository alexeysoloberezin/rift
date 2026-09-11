-- Статус подтверждения участия игрока в турнире ("подтвердил / не
-- подтвердил"). Проставляется вручную админом в таблице зарегистрированных
-- игроков (см. AdminTournamentManageView.vue, PUT
-- /tournaments/:id/players/:playerId/confirm) — импорт из Excel и автосинк
-- из Google Sheets (upsertTournamentPlayers, ON CONFLICT DO UPDATE) это поле
-- не трогают, так что повторная загрузка списка не сбрасывает уже
-- проставленные админом статусы.
ALTER TABLE tournament_players ADD COLUMN IF NOT EXISTS confirmed BOOLEAN NOT NULL DEFAULT false;
