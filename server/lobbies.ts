import { Hono, type Context } from 'hono'
import { MAX_PLAYERS, PLAYER_NAME_MAX_LENGTH } from '../src/game'
import type {
  CurrentLobbyResponse,
  InviteCandidate,
  InviteCandidatesResponse,
  InvitesResponse,
  LobbiesResponse,
  LobbyEvent,
  LobbyInvite,
  LobbyResponse,
  LobbyVisibility,
  MatchSettings,
  StartLobbyResponse,
} from '../src/shared/api'
import { getBot } from '../src/shared/bots'
import { requireUser } from './auth'
import { addChatMessage } from './chat'
import { nowIso, type AppEnv, type Services, type UserRow } from './context'
import { DEFAULT_SETTINGS, userRef } from './data'
import type { Db } from './db'
import {
  openEventStream,
  publishLobby,
  publishLobbyClosed,
  publishLobbyRemoved,
  publishLobbyStarted,
  publishMatch,
  publishUser,
} from './events'
import { badRequest, expectBoolean, expectInteger, expectObject, expectText, forbidden, notFound, readJson, validId } from './http'
import { randomId, randomInviteCode } from './ids'
import {
  currentLobbyFor,
  hasInvite,
  joinCheck,
  liveLobbyMatch,
  lobbyDetail,
  lobbySeats,
  lobbySettings,
  lobbySummary,
  loadLobby,
  MAX_LOBBY_SEATS,
  seatName,
  type LobbyRow,
} from './lobby-data'
import { INVITE_TTL_MS } from './match-limits'
import { insertMatch, parseSettings, type RosterEntry } from './matches'
import { toUserRef } from './users'

const DEFAULT_LOBBY_SETTINGS: MatchSettings = { ...DEFAULT_SETTINGS }
const DEFAULT_CAPACITY = 4
const PUBLIC_LISTING_LIMIT = 50

type LobbyOptions = { visibility: LobbyVisibility; ranked: boolean; capacity: number; settings: MatchSettings }

export function describeSettings(settings: MatchSettings) {
  const rules = [settings.doubleIn ? 'double in' : null, settings.doubleOut ? 'double out' : 'single out'].filter(Boolean).join(' · ')
  return `${settings.game} · ${rules} · first to ${settings.legsToWin}`
}

function parseOptions(body: Record<string, unknown>, current: LobbyOptions): LobbyOptions {
  const next = { ...current }
  if (body.visibility !== undefined) {
    if (body.visibility !== 'public' && body.visibility !== 'private') throw badRequest('visibility must be public or private.')
    next.visibility = body.visibility
  }
  if (body.ranked !== undefined) next.ranked = expectBoolean(body.ranked, 'ranked')
  if (body.capacity !== undefined) next.capacity = expectInteger(body.capacity, 'capacity', 1, MAX_LOBBY_SEATS)
  if (body.settings !== undefined) next.settings = parseSettings(body.settings)
  return next
}

function uniqueLobbyCode(db: Db) {
  for (;;) {
    const code = randomInviteCode()
    if (!db.get('SELECT 1 FROM lobbies WHERE invite_code = ?', code)) return code
  }
}

function requireAccount(c: Context<AppEnv>): UserRow {
  const user = requireUser(c)
  if (user.is_guest) throw forbidden('Sign in with Google to play in lobbies.')
  return user
}

/** Members can always see a lobby; others need it to be public, an invite code or a direct invite. */
function canView(services: Services, lobby: LobbyRow, userId: string, code: string | null) {
  return lobby.visibility === 'public'
    || code === lobby.invite_code
    || !!services.db.get('SELECT 1 FROM lobby_players WHERE lobby_id = ? AND user_id = ?', lobby.id, userId)
    || hasInvite(services.db, lobby.id, userId, services.now())
}

function nextPosition(db: Db, lobbyId: string) {
  return (db.get<{ position: number | null }>('SELECT MAX(position) AS position FROM lobby_players WHERE lobby_id = ?', lobbyId)?.position ?? -1) + 1
}

function touch(services: Services, lobbyId: string) {
  services.db.run('UPDATE lobbies SET updated_at = ? WHERE id = ?', nowIso(services), lobbyId)
}

function say(services: Services, lobbyId: string, userId: string, body: string) {
  addChatMessage(services, { lobbyId }, userId, body, 'system')
}

/**
 * Removes the user's seat from their current lobby. When the leader leaves, the longest-seated
 * player leads and the leader's local players leave with them; an empty lobby closes.
 */
export function leaveCurrentLobby(services: Services, userId: string, how: 'left' | 'removed' = 'left', actorId = userId) {
  const { db } = services
  const lobby = currentLobbyFor(db, userId)
  if (!lobby) return null
  const name = db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', userId)?.name ?? 'A player'
  const outcome = db.transaction(() => {
    db.run('DELETE FROM lobby_players WHERE lobby_id = ? AND user_id = ?', lobby.id, userId)
    db.run('DELETE FROM lobby_invites WHERE lobby_id = ? AND user_id = ?', lobby.id, userId)
    if (how === 'removed') db.run('INSERT OR IGNORE INTO lobby_bans (lobby_id, user_id) VALUES (?, ?)', lobby.id, userId)
    const humans = db.all<{ user_id: string }>('SELECT user_id FROM lobby_players WHERE lobby_id = ? AND user_id IS NOT NULL ORDER BY position, joined_at, id', lobby.id)
    if (!humans.length) {
      db.run('DELETE FROM lobbies WHERE id = ?', lobby.id)
      return { closed: true, newLeader: null as string | null }
    }
    let newLeader: string | null = null
    if (lobby.leader_id === userId) {
      newLeader = humans[0].user_id
      db.run('UPDATE lobbies SET leader_id = ? WHERE id = ?', newLeader, lobby.id)
      db.run('DELETE FROM lobby_players WHERE lobby_id = ? AND local_name IS NOT NULL', lobby.id)
    }
    touch(services, lobby.id)
    return { closed: false, newLeader }
  })
  if (how === 'removed') publishLobbyRemoved(services, lobby.id, userId)
  if (outcome.closed) {
    publishLobbyClosed(services, lobby.id)
    return lobby.id
  }
  say(services, lobby.id, how === 'removed' ? actorId : userId, how === 'removed' ? `${name} was removed from the lobby.` : `${name} left the lobby.`)
  if (outcome.newLeader) {
    const leaderName = db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', outcome.newLeader)?.name ?? 'A player'
    say(services, lobby.id, outcome.newLeader, `${leaderName} is now the lobby leader.`)
  }
  publishLobby(services, lobby.id)
  return lobby.id
}

/** People the leader knows: fellow league members and opponents from earlier lobby games. */
function knownPlayers(db: Db, userId: string) {
  const rows = db.all<{ id: string; name: string; avatar_url: string | null; via: string }>(
    `SELECT u.id, u.name, u.avatar_url, l.name AS via
       FROM league_members mine
       JOIN league_members theirs ON theirs.league_id = mine.league_id AND theirs.user_id <> mine.user_id
       JOIN users u ON u.id = theirs.user_id AND u.is_guest = 0
       JOIN leagues l ON l.id = mine.league_id
      WHERE mine.user_id = ?
     UNION ALL
     SELECT u.id, u.name, u.avatar_url, 'Played together' AS via
       FROM match_players mine
       JOIN matches m ON m.id = mine.match_id AND m.visibility <> 'league'
       JOIN match_players theirs ON theirs.match_id = mine.match_id AND theirs.user_id IS NOT NULL AND theirs.user_id <> mine.user_id
       JOIN users u ON u.id = theirs.user_id AND u.is_guest = 0
      WHERE mine.user_id = ?
     LIMIT 2000`,
    userId, userId,
  )
  const known = new Map<string, (typeof rows)[number]>()
  for (const row of rows) if (!known.has(row.id)) known.set(row.id, row)
  return known
}

export function lobbyRoutes(services: Services) {
  const { db, hub } = services
  const app = new Hono<AppEnv>()

  const requireLobby = (lobbyId: string | undefined) => {
    const lobby = validId(lobbyId) ? loadLobby(db, lobbyId) : undefined
    if (!lobby) throw notFound('This lobby has closed.')
    return lobby
  }
  const requireMember = (lobbyId: string | undefined, userId: string) => {
    const lobby = requireLobby(lobbyId)
    if (!db.get('SELECT 1 FROM lobby_players WHERE lobby_id = ? AND user_id = ?', lobby.id, userId)) throw notFound('You are not in this lobby.')
    return lobby
  }
  const requireLeader = (lobbyId: string | undefined, userId: string) => {
    const lobby = requireMember(lobbyId, userId)
    if (lobby.leader_id !== userId) throw forbidden('Only the lobby leader can do that.')
    return lobby
  }
  const respond = (c: Context<AppEnv>, lobbyId: string, userId: string, status: 200 | 201 = 200) => {
    const lobby = requireLobby(lobbyId)
    return c.json<LobbyResponse>({ lobby: lobbyDetail(services, lobby, userId) }, status)
  }

  app.get('/lobbies', (c) => {
    const user = requireAccount(c)
    const rows = db.all<LobbyRow>("SELECT * FROM lobbies WHERE visibility = 'public' ORDER BY updated_at DESC, id LIMIT 500")
    const listed = rows
      .filter((lobby) => hub.isOnline(lobby.leader_id))
      .filter((lobby) => !db.get('SELECT 1 FROM lobby_bans WHERE lobby_id = ? AND user_id = ?', lobby.id, user.id))
      .map((lobby) => lobbySummary(services, lobby))
      .filter((lobby) => lobby.seats.length < lobby.capacity || lobby.seats.some((seat) => seat.userId === user.id))
      .sort((a, b) => Number(a.playing) - Number(b.playing))
      .slice(0, PUBLIC_LISTING_LIMIT)
    return c.json<LobbiesResponse>({ lobbies: listed })
  })

  app.get('/lobbies/current', (c) => {
    const user = requireAccount(c)
    const lobby = currentLobbyFor(db, user.id)
    return c.json<CurrentLobbyResponse>({ lobby: lobby ? lobbyDetail(services, lobby, user.id) : null })
  })

  app.post('/lobbies', async (c) => {
    const user = requireAccount(c)
    const body = expectObject(await readJson(c, { optional: true }))
    const saved = db.get<{ play_settings: string | null }>('SELECT play_settings FROM users WHERE id = ?', user.id)?.play_settings
    const remembered = ((): Partial<LobbyOptions> => {
      try {
        const value = saved ? JSON.parse(saved) as { settings?: unknown; capacity?: unknown } : {}
        return {
          settings: value.settings === undefined ? undefined : parseSettings(value.settings),
          capacity: typeof value.capacity === 'number' && Number.isInteger(value.capacity) && value.capacity >= 1 && value.capacity <= MAX_LOBBY_SEATS ? value.capacity : undefined,
        }
      } catch { return {} }
    })()
    const defaults: LobbyOptions = {
      visibility: 'private',
      ranked: false,
      capacity: remembered.capacity ?? DEFAULT_CAPACITY,
      settings: remembered.settings ?? DEFAULT_LOBBY_SETTINGS,
    }
    const options = parseOptions(body, defaults)
    leaveCurrentLobby(services, user.id)
    const id = randomId()
    db.transaction(() => {
      const now = nowIso(services)
      db.run(
        'INSERT INTO lobbies (id, leader_id, visibility, ranked, capacity, settings, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, user.id, options.visibility, options.ranked ? 1 : 0, options.capacity, JSON.stringify(options.settings), uniqueLobbyCode(db), now, now,
      )
      db.run('INSERT INTO lobby_players (id, lobby_id, position, user_id, joined_at) VALUES (?, ?, 0, ?, ?)', randomId(), id, user.id, now)
    })
    return respond(c, id, user.id, 201)
  })

  app.get('/lobbies/:lobbyId', (c) => {
    const user = requireAccount(c)
    const lobby = requireLobby(c.req.param('lobbyId'))
    const code = c.req.query('code')?.trim().toUpperCase() ?? null
    if (!canView(services, lobby, user.id, code)) throw notFound('This lobby is private or has closed.')
    return c.json<LobbyResponse>({ lobby: lobbyDetail(services, lobby, user.id, code) })
  })

  app.patch('/lobbies/:lobbyId', async (c) => {
    const user = requireAccount(c)
    requireLeader(c.req.param('lobbyId'), user.id)
    const body = expectObject(await readJson(c))
    const lobby = requireLeader(c.req.param('lobbyId'), user.id) // recheck after the asynchronous body read
    const current: LobbyOptions = { visibility: lobby.visibility, ranked: lobby.ranked === 1, capacity: lobby.capacity, settings: lobbySettings(lobby) }
    const next = parseOptions(body, current)
    const seats = lobbySeats(db, lobby.id)
    if (next.capacity < seats.length) throw badRequest(`${seats.length} players are already seated. Remove someone first.`)
    if (next.ranked && seats.some((seat) => !seat.user_id)) throw badRequest('Ranked games are between accounts only. Remove bots and local players first.')
    if (next.ranked && next.capacity < 2) throw badRequest('Ranked games need room for at least two players.')
    db.transaction(() => {
      db.run(
        'UPDATE lobbies SET visibility = ?, ranked = ?, capacity = ?, settings = ?, updated_at = ? WHERE id = ?',
        next.visibility, next.ranked ? 1 : 0, next.capacity, JSON.stringify(next.settings), nowIso(services), lobby.id,
      )
      db.run('UPDATE users SET play_settings = ? WHERE id = ?', JSON.stringify({ settings: next.settings, capacity: next.capacity }), user.id)
    })
    const changes: string[] = []
    if (JSON.stringify(next.settings) !== JSON.stringify(current.settings)) changes.push(`set the game to ${describeSettings(next.settings)}`)
    if (next.visibility !== current.visibility) changes.push(next.visibility === 'public' ? 'opened the lobby to everyone' : 'made the lobby private')
    if (next.ranked !== current.ranked) changes.push(next.ranked ? 'turned ranked play on' : 'turned ranked play off')
    if (next.capacity !== current.capacity) changes.push(`set ${next.capacity} ${next.capacity === 1 ? 'seat' : 'seats'}`)
    if (changes.length) say(services, lobby.id, user.id, `${user.name} ${changes.join(', ')}.`)
    publishLobby(services, lobby.id)
    return respond(c, lobby.id, user.id)
  })

  app.post('/lobbies/:lobbyId/join', async (c) => {
    const user = requireAccount(c)
    requireLobby(c.req.param('lobbyId'))
    const body = expectObject(await readJson(c, { optional: true }))
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase().slice(0, 32) : null
    const lobby = requireLobby(c.req.param('lobbyId'))
    if (!canView(services, lobby, user.id, code)) throw notFound('This lobby is private or has closed.')
    if (db.get('SELECT 1 FROM lobby_players WHERE lobby_id = ? AND user_id = ?', lobby.id, user.id)) return respond(c, lobby.id, user.id)
    const check = joinCheck(services, lobby, user.id, code)
    if (!check.canJoin) throw forbidden(check.reason ?? 'You cannot join this lobby.')
    leaveCurrentLobby(services, user.id)
    db.transaction(() => {
      const fresh = requireLobby(lobby.id)
      const recheck = joinCheck(services, fresh, user.id, code)
      if (!recheck.canJoin) throw forbidden(recheck.reason ?? 'You cannot join this lobby.')
      db.run('INSERT INTO lobby_players (id, lobby_id, position, user_id, joined_at) VALUES (?, ?, ?, ?, ?)', randomId(), lobby.id, nextPosition(db, lobby.id), user.id, nowIso(services))
      db.run('DELETE FROM lobby_invites WHERE lobby_id = ? AND user_id = ?', lobby.id, user.id)
      db.run('DELETE FROM lobby_bans WHERE lobby_id = ? AND user_id = ?', lobby.id, user.id)
      touch(services, lobby.id)
    })
    say(services, lobby.id, user.id, `${user.name} joined the lobby.`)
    publishLobby(services, lobby.id)
    publishUser(services, user.id, { type: 'invite-removed', lobbyId: lobby.id })
    return respond(c, lobby.id, user.id)
  })

  app.post('/lobbies/:lobbyId/leave', (c) => {
    const user = requireAccount(c)
    requireMember(c.req.param('lobbyId'), user.id)
    leaveCurrentLobby(services, user.id)
    return c.body(null, 204)
  })

  app.post('/lobbies/:lobbyId/seats', async (c) => {
    const user = requireAccount(c)
    requireLeader(c.req.param('lobbyId'), user.id)
    const body = expectObject(await readJson(c))
    const hasBot = body.botId !== undefined
    if (hasBot === (body.localName !== undefined)) throw badRequest('Provide either botId or localName.')
    const bot = hasBot ? (typeof body.botId === 'string' ? getBot(body.botId) : undefined) : undefined
    if (hasBot && !bot) throw badRequest('Choose a bot from the house roster.')
    const localName = hasBot ? null : expectText(body.localName, 'Player name', 1, PLAYER_NAME_MAX_LENGTH)
    const lobby = requireLeader(c.req.param('lobbyId'), user.id)
    const seats = lobbySeats(db, lobby.id)
    if (lobby.ranked) throw badRequest('Ranked games are between accounts only. Turn ranked off to add bots or local players.')
    if (seats.length >= lobby.capacity) throw badRequest(lobby.capacity >= MAX_PLAYERS ? 'All eight seats are taken.' : 'The lobby is full. Add a seat first.')
    if (bot && seats.some((seat) => seat.bot_id === bot.id)) throw badRequest(`${bot.name} is already in the lobby.`)
    const key = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
    if (localName && seats.some((seat) => key(seatName(seat)) === key(localName))) throw badRequest('Someone in the lobby already uses that name.')
    db.transaction(() => {
      db.run(
        'INSERT INTO lobby_players (id, lobby_id, position, bot_id, local_name, joined_at) VALUES (?, ?, ?, ?, ?, ?)',
        randomId(), lobby.id, nextPosition(db, lobby.id), bot?.id ?? null, localName, nowIso(services),
      )
      touch(services, lobby.id)
    })
    say(services, lobby.id, user.id, bot ? `${user.name} added ${bot.name} (bot, level ${bot.difficulty}).` : `${user.name} added ${localName}, playing on ${user.name}'s device.`)
    publishLobby(services, lobby.id)
    return respond(c, lobby.id, user.id, 201)
  })

  app.delete('/lobbies/:lobbyId/seats/:seatId', (c) => {
    const user = requireAccount(c)
    const lobby = requireMember(c.req.param('lobbyId'), user.id)
    const seat = lobbySeats(db, lobby.id).find((item) => item.id === c.req.param('seatId'))
    if (!seat) throw notFound('That player already left.')
    if (seat.user_id === user.id) {
      leaveCurrentLobby(services, user.id)
      return c.body(null, 204)
    }
    if (lobby.leader_id !== user.id) throw forbidden('Only the lobby leader can remove players.')
    if (seat.user_id) {
      leaveCurrentLobby(services, seat.user_id, 'removed', user.id)
      return c.body(null, 204)
    }
    db.transaction(() => {
      db.run('DELETE FROM lobby_players WHERE id = ?', seat.id)
      touch(services, lobby.id)
    })
    say(services, lobby.id, user.id, `${user.name} removed ${seatName(seat)}.`)
    publishLobby(services, lobby.id)
    return c.body(null, 204)
  })

  app.post('/lobbies/:lobbyId/order', async (c) => {
    const user = requireAccount(c)
    requireLeader(c.req.param('lobbyId'), user.id)
    const body = expectObject(await readJson(c))
    const lobby = requireLeader(c.req.param('lobbyId'), user.id)
    const seats = lobbySeats(db, lobby.id)
    const ids = body.seatIds
    if (!Array.isArray(ids) || ids.length !== seats.length || new Set(ids).size !== ids.length || !seats.every((seat) => ids.includes(seat.id))) {
      throw badRequest('seatIds must list every seat exactly once.')
    }
    db.transaction(() => {
      ids.forEach((seatId, position) => db.run('UPDATE lobby_players SET position = ? WHERE id = ? AND lobby_id = ?', position, seatId, lobby.id))
      touch(services, lobby.id)
    })
    publishLobby(services, lobby.id)
    return respond(c, lobby.id, user.id)
  })

  app.post('/lobbies/:lobbyId/invite-code', (c) => {
    const user = requireAccount(c)
    const lobby = requireLeader(c.req.param('lobbyId'), user.id)
    db.transaction(() => {
      db.run('UPDATE lobbies SET invite_code = ?, updated_at = ? WHERE id = ?', uniqueLobbyCode(db), nowIso(services), lobby.id)
    })
    publishLobby(services, lobby.id)
    return respond(c, lobby.id, user.id)
  })

  app.get('/lobbies/:lobbyId/invite-candidates', (c) => {
    const user = requireAccount(c)
    const lobby = requireLeader(c.req.param('lobbyId'), user.id)
    const seated = new Set(lobbySeats(db, lobby.id).flatMap((seat) => seat.user_id ? [seat.user_id] : []))
    const cutoff = new Date(services.now().getTime() - INVITE_TTL_MS).toISOString()
    const invited = new Set(db.all<{ user_id: string }>('SELECT user_id FROM lobby_invites WHERE lobby_id = ? AND created_at > ?', lobby.id, cutoff).map((row) => row.user_id))
    const candidates = [...knownPlayers(db, user.id).values()]
      .filter((row) => row.id !== user.id)
      .map((row): InviteCandidate => ({ ...toUserRef(row), online: hub.isOnline(row.id), invited: invited.has(row.id), member: seated.has(row.id), via: row.via }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
      .slice(0, 100)
    return c.json<InviteCandidatesResponse>({ candidates })
  })

  app.post('/lobbies/:lobbyId/invites', async (c) => {
    const user = requireAccount(c)
    requireLeader(c.req.param('lobbyId'), user.id)
    const body = expectObject(await readJson(c))
    if (typeof body.userId !== 'string' || !validId(body.userId)) throw badRequest('userId is not valid.')
    const targetId = body.userId
    const lobby = requireLeader(c.req.param('lobbyId'), user.id)
    if (!knownPlayers(db, user.id).has(targetId)) throw forbidden('You can invite league members and players you have played with. Share the invite link with anyone else.')
    if (db.get('SELECT 1 FROM lobby_players WHERE lobby_id = ? AND user_id = ?', lobby.id, targetId)) throw badRequest('That player is already in the lobby.')
    const now = nowIso(services)
    db.run(
      'INSERT INTO lobby_invites (lobby_id, user_id, invited_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(lobby_id, user_id) DO UPDATE SET invited_by = excluded.invited_by, created_at = excluded.created_at',
      lobby.id, targetId, user.id, now,
    )
    const invite: LobbyInvite = { lobby: lobbySummary(services, lobby), invitedBy: userRef(db, user.id), createdAt: now }
    publishUser(services, targetId, { type: 'invite', invite })
    publishLobby(services, lobby.id)
    return respond(c, lobby.id, user.id, 201)
  })

  app.delete('/lobbies/:lobbyId/invites/:userId', (c) => {
    const user = requireAccount(c)
    const lobby = requireLeader(c.req.param('lobbyId'), user.id)
    const targetId = c.req.param('userId')
    db.run('DELETE FROM lobby_invites WHERE lobby_id = ? AND user_id = ?', lobby.id, targetId)
    publishUser(services, targetId, { type: 'invite-removed', lobbyId: lobby.id })
    publishLobby(services, lobby.id)
    return respond(c, lobby.id, user.id)
  })

  app.post('/lobbies/:lobbyId/start', (c) => {
    const user = requireAccount(c)
    const lobby = requireLeader(c.req.param('lobbyId'), user.id)
    if (liveLobbyMatch(db, lobby.id)) throw badRequest('A game is already in progress in this lobby.')
    const seats = lobbySeats(db, lobby.id)
    const settings = lobbySettings(lobby)
    if (lobby.ranked && seats.length < 2) throw badRequest('Ranked games need at least two players. Invite someone, or turn ranked off to practise solo.')
    if (lobby.ranked && seats.some((seat) => !seat.user_id)) throw badRequest('Ranked games are between accounts only.')
    const roster = seats.map((seat): RosterEntry => seat.user_id
      ? { userId: seat.user_id, guestId: null, botId: null, controllerId: seat.user_id, name: seatName(seat) }
      : seat.bot_id
        ? { userId: null, guestId: null, botId: seat.bot_id, controllerId: null, name: seatName(seat) }
        : { userId: null, guestId: null, botId: null, controllerId: lobby.leader_id, name: seatName(seat) })
    const matchId = db.transaction(() => {
      const id = insertMatch(services, {
        leagueId: null, lobbyId: lobby.id, visibility: lobby.visibility, createdBy: user.id, ranked: lobby.ranked === 1, settings, roster,
      })
      // The starter rotates: next game, the second player throws first.
      const order = [...seats.slice(1), seats[0]]
      order.forEach((seat, position) => db.run('UPDATE lobby_players SET position = ? WHERE id = ?', position, seat.id))
      touch(services, lobby.id)
      return id
    })
    const who = seats.length === 1 ? 'a solo game' : lobby.ranked ? 'a ranked game' : 'a game'
    say(services, lobby.id, user.id, `${user.name} started ${who}: ${describeSettings(settings)}.`)
    publishMatch(services, matchId)
    publishLobbyStarted(services, lobby.id, matchId)
    return c.json<StartLobbyResponse>({ matchId }, 201)
  })

  app.get('/lobbies/:lobbyId/events', (c) => {
    const user = requireAccount(c)
    const lobby = requireMember(c.req.param('lobbyId'), user.id)
    const initial: LobbyEvent = { type: 'lobby', lobby: lobbyDetail(services, lobby, user.id) }
    return openEventStream(c, services, user.id, { kind: 'lobby', lobbyId: lobby.id }, { event: 'lobby', data: initial })
  })

  app.get('/me/invites', (c) => {
    const user = requireAccount(c)
    const cutoff = new Date(services.now().getTime() - INVITE_TTL_MS).toISOString()
    const rows = db.all<{ lobby_id: string; invited_by: string; created_at: string }>(
      'SELECT lobby_id, invited_by, created_at FROM lobby_invites WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 20',
      user.id, cutoff,
    )
    const invites = rows.flatMap((row): LobbyInvite[] => {
      const lobby = loadLobby(db, row.lobby_id)
      return lobby ? [{ lobby: lobbySummary(services, lobby), invitedBy: userRef(db, row.invited_by), createdAt: row.created_at }] : []
    })
    return c.json<InvitesResponse>({ invites })
  })

  app.delete('/me/invites/:lobbyId', (c) => {
    const user = requireAccount(c)
    const lobbyId = c.req.param('lobbyId')
    const removed = db.run('DELETE FROM lobby_invites WHERE lobby_id = ? AND user_id = ?', lobbyId, user.id).changes > 0
    if (removed) publishLobby(services, lobbyId)
    return c.body(null, 204)
  })

  app.get('/me/events', (c) => {
    const user = requireUser(c)
    return openEventStream(c, services, user.id, { kind: 'user' }, { event: 'ready', data: {} })
  })

  return app
}
