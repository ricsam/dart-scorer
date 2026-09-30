import { Hono } from 'hono'
import type {
  InviteCodeResponse,
  InvitePreview,
  JoinResponse,
  MatchesResponse,
  MatchSettings,
  RoomDetail,
  RoomResponse,
  RoomsResponse,
  RoomSummary,
  UserRef,
} from '../src/shared/api'
import { requireUser, startSession } from './auth'
import { ensureGuest, guestNameKey, parseGuestName, MAX_ROOM_MEMBERS } from './guests'
import type { AppEnv, Services, UserRow } from './context'
import { nowIso } from './context'
import {
  DEFAULT_SETTINGS,
  memberRows,
  requireRoom,
  roomMembers,
  summarize,
  userRef,
  type MatchRow,
  type RoomAccess,
  type RoomRow,
} from './data'
import type { Db } from './db'
import { openEventStream, publishRoomRefresh } from './events'
import { badRequest, expectObject, expectText, forbidden, notFound, queryInteger, readJson, validId } from './http'
import { normalizeInviteCode, randomId, randomInviteCode } from './ids'
import { displayRating, INITIAL_RATING, rankIn, roomRatings } from './ratings'
import { toUserRef } from './users'

export const ROOM_NAME_MAX_LENGTH = 40
export const MAX_OWNED_ROOMS = 20
export { MAX_ROOM_MEMBERS } from './guests'

function uniqueInviteCode(db: Db) {
  for (;;) {
    const code = randomInviteCode()
    if (!db.get('SELECT 1 FROM rooms WHERE invite_code = ?', code)) return code
  }
}

export function roomDetail(db: Db, room: RoomAccess): RoomDetail {
  const live = db.all<MatchRow>("SELECT * FROM matches WHERE room_id = ? AND status = 'live' ORDER BY created_at DESC, id DESC", room.id)
  const recent = db.all<MatchRow>(
    "SELECT * FROM matches WHERE room_id = ? AND status = 'completed' ORDER BY completed_at DESC, id DESC LIMIT 10",
    room.id,
  )
  const latest = db.get<{ settings: string }>('SELECT settings FROM matches WHERE room_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', room.id)
  return {
    id: room.id,
    name: room.name,
    role: room.role,
    owner: userRef(db, room.owner_id),
    createdAt: room.created_at,
    inviteCode: room.invite_code,
    members: roomMembers(db, room.id),
    liveMatches: summarize(db, live),
    recentMatches: summarize(db, recent),
    defaults: latest ? JSON.parse(latest.settings) as MatchSettings : { ...DEFAULT_SETTINGS },
  }
}

type RoomListRow = RoomRow & {
  role: RoomAccess['role']
  member_count: number
  live_count: number
  completed_count: number
  last_activity_at: string
}

function roomSummaries(db: Db, userId: string): RoomSummary[] {
  const rows = db.all<RoomListRow>(
    `SELECT r.*, m.role AS role,
       (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) AS member_count,
       (SELECT COUNT(*) FROM matches WHERE room_id = r.id AND status = 'live') AS live_count,
       (SELECT COUNT(*) FROM matches WHERE room_id = r.id AND status = 'completed') AS completed_count,
       MAX(r.updated_at, COALESCE((SELECT MAX(updated_at) FROM matches WHERE room_id = r.id), r.updated_at)) AS last_activity_at
     FROM room_members m JOIN rooms r ON r.id = m.room_id
     WHERE m.user_id = ?
     ORDER BY last_activity_at DESC, r.id`,
    userId,
  )
  return rows.map((row) => {
    const members = memberRows(db, row.id)
    const ratings = roomRatings(db, row.id)
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      memberCount: row.member_count,
      members: members.slice(0, 5).map(toUserRef),
      liveMatches: row.live_count,
      completedMatches: row.completed_count,
      myRating: displayRating(ratings.get(userId)?.rating ?? INITIAL_RATING),
      myRank: rankIn(ratings, members.filter((member) => !member.is_guest).map((member) => member.id), userId),
      lastActivityAt: row.last_activity_at,
    }
  })
}

function requireOwner(room: RoomAccess) {
  if (room.role !== 'owner') throw forbidden('Only the room owner can do that.')
}

export function roomRoutes(services: Services) {
  const { db, hub } = services
  const app = new Hono<AppEnv>()

  app.get('/rooms', (c) => {
    const user = requireUser(c)
    return c.json<RoomsResponse>({ rooms: roomSummaries(db, user.id) })
  })

  app.post('/rooms', async (c) => {
    const user = requireUser(c)
    if (user.is_guest) throw forbidden('Guests cannot create rooms.')
    const body = expectObject(await readJson(c))
    const name = expectText(body.name, 'Room name', 1, ROOM_NAME_MAX_LENGTH)
    const room = db.transaction(() => {
      const owned = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM rooms WHERE owner_id = ?', user.id)?.count ?? 0
      if (owned >= MAX_OWNED_ROOMS) throw badRequest(`You can own at most ${MAX_OWNED_ROOMS} rooms.`)
      const now = nowIso(services)
      const row: RoomRow = { id: randomId(), name, owner_id: user.id, invite_code: uniqueInviteCode(db), created_at: now, updated_at: now }
      db.run(
        'INSERT INTO rooms (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        row.id, row.name, row.owner_id, row.invite_code, row.created_at, row.updated_at,
      )
      db.run("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)", row.id, user.id, now)
      return { ...row, role: 'owner' as const }
    })
    return c.json<RoomResponse>({ room: roomDetail(db, room) }, 201)
  })

  app.get('/rooms/:roomId', (c) => {
    const user = requireUser(c)
    const room = requireRoom(db, c.req.param('roomId'), user.id)
    return c.json<RoomResponse>({ room: roomDetail(db, room) })
  })

  app.patch('/rooms/:roomId', async (c) => {
    const user = requireUser(c)
    requireOwner(requireRoom(db, c.req.param('roomId'), user.id))
    const body = expectObject(await readJson(c))
    const name = expectText(body.name, 'Room name', 1, ROOM_NAME_MAX_LENGTH)
    // Re-check synchronously: the room may have changed while the body was read.
    const room = requireRoom(db, c.req.param('roomId'), user.id)
    requireOwner(room)
    const now = nowIso(services)
    db.run('UPDATE rooms SET name = ?, updated_at = ? WHERE id = ?', name, now, room.id)
    publishRoomRefresh(services, room.id)
    return c.json<RoomResponse>({ room: roomDetail(db, { ...room, name, updated_at: now }) })
  })

  app.delete('/rooms/:roomId', (c) => {
    const user = requireUser(c)
    const room = requireRoom(db, c.req.param('roomId'), user.id)
    requireOwner(room)
    db.transaction(() => {
      db.run('DELETE FROM rooms WHERE id = ?', room.id)
    })
    publishRoomRefresh(services, room.id)
    hub.closeRoom(room.id)
    return c.body(null, 204)
  })

  app.post('/rooms/:roomId/invite', (c) => {
    const user = requireUser(c)
    const room = requireRoom(db, c.req.param('roomId'), user.id)
    requireOwner(room)
    const inviteCode = db.transaction(() => {
      const code = uniqueInviteCode(db)
      db.run('UPDATE rooms SET invite_code = ? WHERE id = ?', code, room.id)
      return code
    })
    publishRoomRefresh(services, room.id)
    return c.json<InviteCodeResponse>({ inviteCode })
  })

  app.delete('/rooms/:roomId/members/:userId', (c) => {
    const user = requireUser(c)
    const room = requireRoom(db, c.req.param('roomId'), user.id)
    const targetId = c.req.param('userId')
    if (targetId === user.id) {
      if (room.role === 'owner') throw badRequest('The owner cannot leave the room. Delete it instead.')
    } else {
      requireOwner(room)
      if (!validId(targetId) || !db.get('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?', room.id, targetId)) {
        throw notFound('Member not found.')
      }
    }
    db.transaction(() => {
      db.run('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', room.id, targetId)
      db.run('UPDATE rooms SET updated_at = ? WHERE id = ?', nowIso(services), room.id)
    })
    hub.closeRoom(room.id, targetId)
    publishRoomRefresh(services, room.id)
    return c.body(null, 204)
  })

  app.get('/rooms/:roomId/matches', (c) => {
    const user = requireUser(c)
    const room = requireRoom(db, c.req.param('roomId'), user.id)
    const limit = queryInteger(c.req.query('limit'), 'limit', 1, 50, 20)
    const rawBefore = c.req.query('before')
    let before: string | null = null
    if (rawBefore !== undefined && rawBefore !== '') {
      const time = rawBefore.length <= 40 ? Date.parse(rawBefore) : Number.NaN
      if (Number.isNaN(time)) throw badRequest('before must be an ISO timestamp.')
      before = new Date(time).toISOString()
    }
    const rows = db.all<MatchRow>(
      `SELECT * FROM matches
       WHERE room_id = ? AND status = 'completed' AND (? IS NULL OR completed_at < ?)
       ORDER BY completed_at DESC, id DESC LIMIT ?`,
      room.id, before, before, limit + 1,
    )
    return c.json<MatchesResponse>({ matches: summarize(db, rows.slice(0, limit)), hasMore: rows.length > limit })
  })

  app.get('/rooms/:roomId/events', (c) => {
    const user = requireUser(c)
    const room = requireRoom(db, c.req.param('roomId'), user.id)
    return openEventStream(c, services, user.id, { kind: 'room', roomId: room.id }, { event: 'room', data: { type: 'refresh' } })
  })

  // ── Invites ───────────────────────────────────────────────────────────────

  const roomByInvite = (rawCode: string) => {
    const code = normalizeInviteCode(rawCode)
    const room = code ? db.get<RoomRow>('SELECT * FROM rooms WHERE invite_code = ?', code) : undefined
    if (!room) throw notFound('This invite link is not valid. Ask for a new one.')
    return room
  }

  app.get('/invites/:code', (c) => {
    const room = roomByInvite(c.req.param('code'))
    const viewer = c.get('user')
    const memberCount = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM room_members WHERE room_id = ?', room.id)?.count ?? 0
    const owner: UserRef = userRef(db, room.owner_id)
    const member = viewer ? !!db.get('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?', room.id, viewer.id) : false
    return c.json<InvitePreview>({ room: { id: room.id, name: room.name, memberCount, owner }, member,
      guests: roomMembers(db, room.id).filter((member) => member.guest && !member.claimed).map(({ id, name }) => ({ id, name })),
    })
  })

  app.post('/invites/:code/join', (c) => {
    const user = requireUser(c)
    if (user.is_guest) throw forbidden('Leave your guest session before joining another room.')
    const room = roomByInvite(c.req.param('code'))
    const joined = db.transaction(() => {
      if (db.get('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?', room.id, user.id)) return false
      const count = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM room_members WHERE room_id = ?', room.id)?.count ?? 0
      if (count >= MAX_ROOM_MEMBERS) throw badRequest(`This room is full (${MAX_ROOM_MEMBERS} members).`)
      const now = nowIso(services)
      db.run("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)", room.id, user.id, now)
      db.run('UPDATE rooms SET updated_at = ? WHERE id = ?', now, room.id)
      return true
    })
    if (joined) publishRoomRefresh(services, room.id)
    return c.json<JoinResponse>({ roomId: room.id })
  })

  app.post('/rooms/:roomId/guests', async (c) => {
    const user = requireUser(c)
    const roomId = requireRoom(db, c.req.param('roomId'), user.id).id
    const body = expectObject(await readJson(c))
    const name = parseGuestName(body.name)
    const guest = db.transaction(() => {
      requireRoom(db, roomId, user.id)
      return ensureGuest(services, roomId, name)
    })
    publishRoomRefresh(services, roomId)
    return c.json({ guest: roomMembers(db, roomId).find((member) => member.id === guest.id)! }, 201)
  })

  app.post('/invites/:code/guest', async (c) => {
    const body = expectObject(await readJson(c))
    const hasName = body.name !== undefined
    const hasId = body.guestId !== undefined
    if (hasName === hasId) throw badRequest('Provide either name or guestId.')
    const name = hasName ? parseGuestName(body.name) : null
    if (hasId && (typeof body.guestId !== 'string' || !validId(body.guestId))) throw badRequest('guestId is not valid.')
    const viewer = c.get('user')
    const result = db.transaction(() => {
      const room = roomByInvite(c.req.param('code')) // recheck after asynchronous body read
      if (viewer) {
        if (!viewer.is_guest || viewer.guest_room_id !== room.id) throw forbidden('Leave your current session first.')
        requireRoom(db, room.id, viewer.id)
        if ((hasId && body.guestId !== viewer.id) || (name !== null && guestNameKey(name) !== viewer.guest_name_key)) throw forbidden('Leave your current session first.')
        return { roomId: room.id, guestId: viewer.id, existing: true }
      }
      const guest = name !== null ? ensureGuest(services, room.id, name) : db.get<UserRow>(
        'SELECT u.* FROM users u JOIN room_members m ON m.user_id = u.id WHERE u.id = ? AND u.is_guest = 1 AND u.guest_room_id = ? AND m.room_id = ?',
        body.guestId as string, room.id, room.id,
      )
      if (!guest) throw notFound('Guest not found.')
      if (guest.claimed || db.run('UPDATE users SET claimed = 1 WHERE id = ? AND claimed = 0', guest.id).changes !== 1) throw forbidden('This guest has already been claimed. Choose another name.')
      startSession(c, services, guest.id)
      return { roomId: room.id, guestId: guest.id, existing: false }
    })
    publishRoomRefresh(services, result.roomId)
    return c.json<JoinResponse>({ roomId: result.roomId })
  })

  return app
}
