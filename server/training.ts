import { Hono } from 'hono'
import { MAX_TRAINING_ENTRY_LENGTH, reduceTraining, trainingResults, type TrainingMode, type TrainingPlayer, type TrainingSession, type TrainingState, type TrainingAction } from '../src/shared/training'
import { requireUser } from './auth'
import { nowIso, type AppEnv, type Services, type UserRow } from './context'
import { requireRoom } from './data'
import { ApiException, badRequest, expectInteger, expectObject, expectString, forbidden, notFound, readJson, validId } from './http'
import { randomId } from './ids'

type Row = { id: string; room_id: string | null; created_by: string; mode: TrainingMode; status: 'live' | 'completed'; players: string; state: string; version: number; created_at: string; completed_at: string | null }
export function trainingRoutes(services: Services) {
  const { db } = services
  const app = new Hono<AppEnv>()
  function view(row: Row, userId: string): TrainingSession {
    const players = JSON.parse(row.players) as TrainingPlayer[]
    const state = JSON.parse(row.state) as TrainingState
    const room = row.room_id ? requireRoom(db, row.room_id, userId) : null
    if (!room && row.created_by !== userId) throw notFound('Training not found.')
    return { id: row.id, roomId: row.room_id, roomName: room?.name ?? null, mode: row.mode, status: row.status, players, state, version: row.version, createdAt: row.created_at, completedAt: row.completed_at, canScore: row.status === 'live' && players.some((p) => p.id === userId), canDelete: row.created_by === userId, results: trainingResults(row.mode, players, state) }
  }
  function get(id: string, userId: string) {
    const row = validId(id) ? db.get<Row>('SELECT * FROM training_sessions WHERE id = ?', id) : undefined
    if (!row) throw notFound('Training not found.')
    return { row, session: view(row, userId) }
  }
  app.get('/training', (c) => {
    const user = requireUser(c)
    const status = c.req.query('status')
    if (status !== undefined && status !== 'live' && status !== 'completed') throw badRequest('Invalid training status.')
    const rows = db.all<Row>(`SELECT t.* FROM training_sessions t WHERE
      EXISTS (SELECT 1 FROM json_each(t.players) p WHERE json_extract(p.value, '$.id') = ?)
      AND (t.room_id IS NULL AND t.created_by = ? OR EXISTS (SELECT 1 FROM room_members m WHERE m.room_id = t.room_id AND m.user_id = ?))
      AND (? IS NULL OR t.status = ?) ORDER BY t.created_at DESC, t.rowid DESC LIMIT 100`, user.id, user.id, user.id, status ?? null, status ?? null)
    return c.json({ sessions: rows.map((r) => view(r, user.id)) })
  })
  app.post('/training', async (c) => {
    requireUser(c)
    const body = expectObject(await readJson(c))
    const user = requireUser(c)
    if (body.mode !== 'around-clock' && body.mode !== 'nine-dart') throw badRequest('Invalid training mode.')
    const roomId = body.roomId === undefined ? null : expectString(body.roomId, 'roomId', 64)
    if (roomId !== null) requireRoom(db, roomId, user.id)
    const ids = body.playerIds === undefined ? [user.id] : body.playerIds
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || ids.some((id) => !validId(id)) || new Set(ids).size !== ids.length || !ids.includes(user.id)) throw badRequest('Choose 1–8 distinct players, including yourself.')
    if (!roomId && (ids.length !== 1 || ids[0] !== user.id)) throw badRequest('Solo training is private.')
    const players: TrainingPlayer[] = ids.map((id: string) => {
      const member = roomId ? db.get<UserRow>('SELECT u.* FROM users u JOIN room_members m ON m.user_id = u.id WHERE m.room_id = ? AND u.id = ?', roomId, id) : user
      if (!member || (roomId !== null && member.is_guest && member.guest_room_id !== roomId)) throw badRequest('Players must be current room members. Bots are not supported.')
      return { id: member.id, name: member.name, guest: Boolean(member.is_guest) }
    })
    for (const player of players) {
      const count = db.get<{ n: number }>(`SELECT count(*) AS n FROM training_sessions t WHERE status = 'live' AND EXISTS (SELECT 1 FROM json_each(t.players) p WHERE json_extract(p.value, '$.id') = ?)`, player.id)!.n
      if (count >= 10) throw badRequest('A player already has 10 live training sessions.')
    }
    const id = randomId()
    db.run("INSERT INTO training_sessions (id, room_id, created_by, mode, status, players, state, version, created_at) VALUES (?, ?, ?, ?, 'live', ?, ?, 0, ?)", id, roomId, user.id, body.mode, JSON.stringify(players), JSON.stringify({ active: 0, throws: [] }), nowIso(services))
    return c.json({ session: get(id, user.id).session }, 201)
  })
  app.get('/training/:id', (c) => c.json({ session: get(c.req.param('id'), requireUser(c).id).session }))
  app.post('/training/:id/actions', async (c) => {
    requireUser(c)
    const body = expectObject(await readJson(c))
    const user = requireUser(c)
    const { row, session } = get(c.req.param('id'), user.id)
    if (!session.players.some((p) => p.id === user.id)) throw forbidden()
    const version = expectInteger(body.baseVersion, 'baseVersion', 0)
    if (version !== row.version) throw new ApiException(409, 'conflict', 'Training changed. Reload and try again.', { session })
    if (row.status !== 'live') throw badRequest('Completed training cannot be edited.')
    const input = expectObject(body.action, 'action')
    let action: TrainingAction
    if (input.type === 'undo') action = { type: 'undo' }
    else if (input.type === 'submit') action = { type: 'submit', entry: expectString(input.entry, 'entry', MAX_TRAINING_ENTRY_LENGTH) }
    else throw badRequest('Invalid training action.')
    let state: TrainingState
    try { state = reduceTraining(row.mode, session.players, session.state, action) } catch (error) { throw badRequest((error as Error).message) }
    const completed = trainingResults(row.mode, session.players, state).every((p) => p.finished)
    db.run('UPDATE training_sessions SET state = ?, version = version + 1, status = ?, completed_at = ? WHERE id = ?', JSON.stringify(state), completed ? 'completed' : 'live', completed ? nowIso(services) : null, row.id)
    return c.json({ session: get(row.id, user.id).session })
  })
  app.delete('/training/:id', (c) => {
    const { session } = get(c.req.param('id'), requireUser(c).id)
    if (!session.canDelete) throw forbidden()
    db.run('DELETE FROM training_sessions WHERE id = ?', session.id)
    return c.body(null, 204)
  })
  return app
}
