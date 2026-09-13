function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export async function setMatchStage(tx, matchId, stage) {
  const { rows: matchRows } = await tx.query('SELECT id, tournament_id FROM matches WHERE id = $1 FOR UPDATE', [matchId]);
  if (!matchRows.length) return null;
  const match = matchRows[0];
  await tx.query('UPDATE matches SET group_id = NULL WHERE id = $1', [match.id]);
  // Only this match is removed. Other maps in the same playoff series stay linked.
  await tx.query('DELETE FROM bracket_slot_matches WHERE match_id = $1', [match.id]);

  if (stage?.startsWith('group:')) {
    const groupId = stage.slice('group:'.length);
    const { rows: groups } = await tx.query('SELECT id FROM groups WHERE id = $1 AND tournament_id = $2 FOR KEY SHARE', [groupId, match.tournament_id]);
    if (!groups.length) throw badRequest('Группа не найдена в турнире матча');
    await tx.query('UPDATE matches SET group_id = $1 WHERE id = $2', [groupId, match.id]);
  } else if (stage) {
    const [round, slotIndexText] = stage.split(':');
    const slotIndex = Number(slotIndexText);
    if (!['semifinal', 'final'].includes(round) || !Number.isInteger(slotIndex)) throw badRequest('Некорректный этап плей-офф');
    const { rows: slots } = await tx.query(
      'SELECT id FROM bracket_slots WHERE tournament_id = $1 AND round = $2 AND slot_index = $3 FOR UPDATE',
      [match.tournament_id, round, slotIndex]);
    if (!slots.length) throw badRequest('Слот сетки не найден');
    await tx.query('INSERT INTO bracket_slot_matches (slot_id, match_id) VALUES ($1, $2)', [slots[0].id, match.id]);
    await tx.query('UPDATE bracket_slots SET updated_at = now() WHERE id = $1', [slots[0].id]);
  }
  const { rows } = await tx.query('SELECT * FROM matches WHERE id = $1', [match.id]);
  return rows[0];
}
