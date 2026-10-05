import { Hono } from 'hono'
import type {
  InviteCodeResponse,
  InvitePreview,
  JoinResponse,
  MatchesResponse,
  MatchSettings,
  LeagueDetail,
  LeagueResponse,
  LeaguesResponse,
  LeagueSummary,
  UserRef,
} from '../src/shared/api'
import { requireUser, startSession } from './auth'
import { ensureGuest, guestNameKey, parseGuestName, MAX_LEAGUE_MEMBERS } from './guests'
import type { AppEnv, Services, UserRow } from './context'
import { nowIso } from './context'
import {
  DEFAULT_SETTINGS,
  memberRows,
  requireLeague,
  leagueMembers,
  summarize,
  userRef,
  type MatchRow,
  type LeagueAccess,
  type LeagueRow,
} from './data'
import type { Db } from './db'
import { openEventStream, publishLeagueRefresh } from './events'
import { badRequest, expectObject, expectText, forbidden, notFound, queryInteger, readJson, validId } from './http'
import { normalizeInviteCode, randomId, randomInviteCode } from './ids'
import { displayRating, INITIAL_RATING, rankIn, leagueRatings } from './ratings'
import { toUserRef } from './users'

export const LEAGUE_NAME_MAX_LENGTH = 40
export const MAX_OWNED_LEAGUES = 20
export { MAX_LEAGUE_MEMBERS } from './guests'

function uniqueInviteCode(db: Db) {
  for (;;) {
    const code = randomInviteCode()
    if (!db.get('SELECT 1 FROM leagues WHERE invite_code = ?', code)) return code
  }
}

export function leagueDetail(db: Db, league: LeagueAccess): LeagueDetail {
  const live = db.all<MatchRow>("SELECT * FROM matches WHERE league_id = ? AND status = 'live' ORDER BY created_at DESC, id DESC", league.id)
  const recent = db.all<MatchRow>(
    "SELECT * FROM matches WHERE league_id = ? AND status = 'completed' ORDER BY completed_at DESC, id DESC LIMIT 10",
    league.id,
  )
  const latest = db.get<{ settings: string }>('SELECT settings FROM matches WHERE league_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', league.id)
  return {
    id: league.id,
    name: league.name,
    role: league.role,
    owner: userRef(db, league.owner_id),
    createdAt: league.created_at,
    inviteCode: league.invite_code,
    members: leagueMembers(db, league.id),
    liveMatches: summarize(db, live),
    recentMatches: summarize(db, recent),
    defaults: latest ? JSON.parse(latest.settings) as MatchSettings : { ...DEFAULT_SETTINGS },
  }
}

type LeagueListRow = LeagueRow & {
  role: LeagueAccess['role']
  member_count: number
  live_count: number
  completed_count: number
  last_activity_at: string
}

function leagueSummaries(db: Db, userId: string): LeagueSummary[] {
  const rows = db.all<LeagueListRow>(
    `SELECT r.*, m.role AS role,
       (SELECT COUNT(*) FROM league_members WHERE league_id = r.id) AS member_count,
       (SELECT COUNT(*) FROM matches WHERE league_id = r.id AND status = 'live') AS live_count,
       (SELECT COUNT(*) FROM matches WHERE league_id = r.id AND status = 'completed') AS completed_count,
       MAX(r.updated_at, COALESCE((SELECT MAX(updated_at) FROM matches WHERE league_id = r.id), r.updated_at)) AS last_activity_at
     FROM league_members m JOIN leagues r ON r.id = m.league_id
     WHERE m.user_id = ?
     ORDER BY last_activity_at DESC, r.id`,
    userId,
  )
  return rows.map((row) => {
    const members = memberRows(db, row.id)
    const ratings = leagueRatings(db, row.id)
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

function requireOwner(league: LeagueAccess) {
  if (league.role !== 'owner') throw forbidden('Only the league owner can do that.')
}

export function leagueRoutes(services: Services) {
  const { db, hub } = services
  const app = new Hono<AppEnv>()

  app.get('/leagues', (c) => {
    const user = requireUser(c)
    return c.json<LeaguesResponse>({ leagues: leagueSummaries(db, user.id) })
  })

  app.post('/leagues', async (c) => {
    const user = requireUser(c)
    if (user.is_guest) throw forbidden('Guests cannot create leagues.')
    const body = expectObject(await readJson(c))
    const name = expectText(body.name, 'League name', 1, LEAGUE_NAME_MAX_LENGTH)
    const league = db.transaction(() => {
      const owned = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM leagues WHERE owner_id = ?', user.id)?.count ?? 0
      if (owned >= MAX_OWNED_LEAGUES) throw badRequest(`You can own at most ${MAX_OWNED_LEAGUES} leagues.`)
      const now = nowIso(services)
      const row: LeagueRow = { id: randomId(), name, owner_id: user.id, invite_code: uniqueInviteCode(db), created_at: now, updated_at: now }
      db.run(
        'INSERT INTO leagues (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        row.id, row.name, row.owner_id, row.invite_code, row.created_at, row.updated_at,
      )
      db.run("INSERT INTO league_members (league_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)", row.id, user.id, now)
      return { ...row, role: 'owner' as const }
    })
    return c.json<LeagueResponse>({ league: leagueDetail(db, league) }, 201)
  })

  app.get('/leagues/:leagueId', (c) => {
    const user = requireUser(c)
    const league = requireLeague(db, c.req.param('leagueId'), user.id)
    return c.json<LeagueResponse>({ league: leagueDetail(db, league) })
  })

  app.patch('/leagues/:leagueId', async (c) => {
    const user = requireUser(c)
    requireOwner(requireLeague(db, c.req.param('leagueId'), user.id))
    const body = expectObject(await readJson(c))
    const name = expectText(body.name, 'League name', 1, LEAGUE_NAME_MAX_LENGTH)
    // Re-check synchronously: the league may have changed while the body was read.
    const league = requireLeague(db, c.req.param('leagueId'), user.id)
    requireOwner(league)
    const now = nowIso(services)
    db.run('UPDATE leagues SET name = ?, updated_at = ? WHERE id = ?', name, now, league.id)
    publishLeagueRefresh(services, league.id)
    return c.json<LeagueResponse>({ league: leagueDetail(db, { ...league, name, updated_at: now }) })
  })

  app.delete('/leagues/:leagueId', (c) => {
    const user = requireUser(c)
    const league = requireLeague(db, c.req.param('leagueId'), user.id)
    requireOwner(league)
    const liveMatches = db.all<{ id: string }>("SELECT id FROM matches WHERE league_id = ? AND status = 'live'", league.id)
    db.transaction(() => {
      db.run('DELETE FROM leagues WHERE id = ?', league.id)
    })
    for (const match of liveMatches) services.bots.cancel(match.id)
    publishLeagueRefresh(services, league.id)
    hub.closeLeague(league.id)
    return c.body(null, 204)
  })

  app.post('/leagues/:leagueId/invite', (c) => {
    const user = requireUser(c)
    const league = requireLeague(db, c.req.param('leagueId'), user.id)
    requireOwner(league)
    const inviteCode = db.transaction(() => {
      const code = uniqueInviteCode(db)
      db.run('UPDATE leagues SET invite_code = ? WHERE id = ?', code, league.id)
      return code
    })
    publishLeagueRefresh(services, league.id)
    return c.json<InviteCodeResponse>({ inviteCode })
  })

  app.delete('/leagues/:leagueId/members/:userId', (c) => {
    const user = requireUser(c)
    const league = requireLeague(db, c.req.param('leagueId'), user.id)
    const targetId = c.req.param('userId')
    if (targetId === user.id) {
      if (league.role === 'owner') throw badRequest('The owner cannot leave the league. Delete it instead.')
    } else {
      requireOwner(league)
      if (!validId(targetId) || !db.get('SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?', league.id, targetId)) {
        throw notFound('Member not found.')
      }
    }
    db.transaction(() => {
      db.run('DELETE FROM league_members WHERE league_id = ? AND user_id = ?', league.id, targetId)
      db.run('UPDATE leagues SET updated_at = ? WHERE id = ?', nowIso(services), league.id)
    })
    hub.closeLeague(league.id, targetId)
    publishLeagueRefresh(services, league.id)
    return c.body(null, 204)
  })

  app.get('/leagues/:leagueId/matches', (c) => {
    const user = requireUser(c)
    const league = requireLeague(db, c.req.param('leagueId'), user.id)
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
       WHERE league_id = ? AND status = 'completed' AND (? IS NULL OR completed_at < ?)
       ORDER BY completed_at DESC, id DESC LIMIT ?`,
      league.id, before, before, limit + 1,
    )
    return c.json<MatchesResponse>({ matches: summarize(db, rows.slice(0, limit)), hasMore: rows.length > limit })
  })

  app.get('/leagues/:leagueId/events', (c) => {
    const user = requireUser(c)
    const league = requireLeague(db, c.req.param('leagueId'), user.id)
    return openEventStream(c, services, user.id, { kind: 'league', leagueId: league.id }, { event: 'league', data: { type: 'refresh' } })
  })

  // ── Invites ───────────────────────────────────────────────────────────────

  const leagueByInvite = (rawCode: string) => {
    const code = normalizeInviteCode(rawCode)
    const league = code ? db.get<LeagueRow>('SELECT * FROM leagues WHERE invite_code = ?', code) : undefined
    if (!league) throw notFound('This invite link is not valid. Ask for a new one.')
    return league
  }

  app.get('/invites/:code', (c) => {
    const league = leagueByInvite(c.req.param('code'))
    const viewer = c.get('user')
    const memberCount = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM league_members WHERE league_id = ?', league.id)?.count ?? 0
    const owner: UserRef = userRef(db, league.owner_id)
    const member = viewer ? !!db.get('SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?', league.id, viewer.id) : false
    return c.json<InvitePreview>({ league: { id: league.id, name: league.name, memberCount, owner }, member,
      guests: leagueMembers(db, league.id).filter((member) => member.guest && !member.claimed).map(({ id, name }) => ({ id, name })),
    })
  })

  app.post('/invites/:code/join', (c) => {
    const user = requireUser(c)
    if (user.is_guest) throw forbidden('Leave your guest session before joining another league.')
    const league = leagueByInvite(c.req.param('code'))
    const joined = db.transaction(() => {
      if (db.get('SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?', league.id, user.id)) return false
      const count = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM league_members WHERE league_id = ?', league.id)?.count ?? 0
      if (count >= MAX_LEAGUE_MEMBERS) throw badRequest(`This league is full (${MAX_LEAGUE_MEMBERS} members).`)
      const now = nowIso(services)
      db.run("INSERT INTO league_members (league_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)", league.id, user.id, now)
      db.run('UPDATE leagues SET updated_at = ? WHERE id = ?', now, league.id)
      return true
    })
    if (joined) publishLeagueRefresh(services, league.id)
    return c.json<JoinResponse>({ leagueId: league.id })
  })

  app.post('/leagues/:leagueId/guests', async (c) => {
    const user = requireUser(c)
    const leagueId = requireLeague(db, c.req.param('leagueId'), user.id).id
    const body = expectObject(await readJson(c))
    const name = parseGuestName(body.name)
    const guest = db.transaction(() => {
      requireLeague(db, leagueId, user.id)
      return ensureGuest(services, leagueId, name)
    })
    publishLeagueRefresh(services, leagueId)
    return c.json({ guest: leagueMembers(db, leagueId).find((member) => member.id === guest.id)! }, 201)
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
      const league = leagueByInvite(c.req.param('code')) // recheck after asynchronous body read
      if (viewer) {
        if (!viewer.is_guest || viewer.guest_league_id !== league.id) throw forbidden('Leave your current session first.')
        requireLeague(db, league.id, viewer.id)
        if ((hasId && body.guestId !== viewer.id) || (name !== null && guestNameKey(name) !== viewer.guest_name_key)) throw forbidden('Leave your current session first.')
        return { leagueId: league.id, guestId: viewer.id, existing: true }
      }
      const guest = name !== null ? ensureGuest(services, league.id, name) : db.get<UserRow>(
        'SELECT u.* FROM users u JOIN league_members m ON m.user_id = u.id WHERE u.id = ? AND u.is_guest = 1 AND u.guest_league_id = ? AND m.league_id = ?',
        body.guestId as string, league.id, league.id,
      )
      if (!guest) throw notFound('Guest not found.')
      if (guest.claimed || db.run('UPDATE users SET claimed = 1 WHERE id = ? AND claimed = 0', guest.id).changes !== 1) throw forbidden('This guest has already been claimed. Choose another name.')
      startSession(c, services, guest.id)
      return { leagueId: league.id, guestId: guest.id, existing: false }
    })
    publishLeagueRefresh(services, result.leagueId)
    return c.json<JoinResponse>({ leagueId: result.leagueId })
  })

  return app
}
