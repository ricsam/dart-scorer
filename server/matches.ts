import { Hono } from 'hono'
import {
  computePlayerStats,
  evaluateOnlineEntry,
  createGameState,
  GAMES,
  gameReducer,
  MATCH_ACTION_TYPES,
  matchPlacings,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_NAME_MAX_LENGTH,
  type GameAction,
} from '../src/game'
import type { MatchConflictResponse, MatchEvent, MatchResponse, MatchSettings } from '../src/shared/api'
import { requireUser } from './auth'
import type { AppEnv, Services, UserRow } from './context'
import { nowIso } from './context'
import { buildMatchView, matchDetail, requireMatchRow, requireRoom, type MatchRow, type MatchView } from './data'
import { openEventStream, publishMatch, publishMatchDeleted } from './events'
import {
  ApiException,
  badRequest,
  expectBoolean,
  expectInteger,
  expectObject,
  expectString,
  expectText,
  forbidden,
  isObject,
  readJson,
  validId,
} from './http'
import { randomId } from './ids'
import { recomputeRoomRatings } from './ratings'

export const MAX_LIVE_MATCHES_PER_ROOM = 10
export const MAX_LEGS_TO_WIN = 11
/** Guards against unbounded growth (e.g. endless busts) of a stored match. */
export const MAX_STATE_BYTES = 8 * 1024 * 1024

export function parseSettings(value: unknown): MatchSettings {
  const settings = expectObject(value, 'settings')
  const game = expectInteger(settings.game, 'settings.game', 0, 10_000)
  if (!GAMES.includes(game)) throw badRequest(`settings.game must be one of ${GAMES.join(', ')}.`)
  return {
    game,
    doubleIn: expectBoolean(settings.doubleIn, 'settings.doubleIn'),
    doubleOut: expectBoolean(settings.doubleOut, 'settings.doubleOut'),
    legsToWin: expectInteger(settings.legsToWin, 'settings.legsToWin', 1, MAX_LEGS_TO_WIN),
  }
}

type PlayerInput = { userId: string } | { guestName: string }

export function parsePlayers(value: unknown): PlayerInput[] {
  if (!Array.isArray(value)) throw badRequest('players must be an array.')
  if (value.length < MIN_PLAYERS || value.length > MAX_PLAYERS) throw badRequest(`A match needs ${MIN_PLAYERS}–${MAX_PLAYERS} players.`)
  const seen = new Set<string>()
  return value.map((item, index): PlayerInput => {
    if (!isObject(item)) throw badRequest(`players[${index}] must be an object.`)
    const hasUser = item.userId !== undefined
    const hasGuest = item.guestName !== undefined
    if (hasUser === hasGuest) throw badRequest(`players[${index}] needs either userId or guestName.`)
    if (hasUser) {
      if (typeof item.userId !== 'string' || !validId(item.userId)) throw badRequest(`players[${index}].userId is not valid.`)
      if (seen.has(item.userId)) throw badRequest('A player can only be added once.')
      seen.add(item.userId)
      return { userId: item.userId }
    }
    return { guestName: expectText(item.guestName, `players[${index}].guestName`, 1, PLAYER_NAME_MAX_LENGTH) }
  })
}

type MatchActionType = (typeof MATCH_ACTION_TYPES)[number]

export function parseAction(value: unknown): GameAction {
  const action = expectObject(value, 'action')
  const type = action.type
  if (typeof type !== 'string' || !(MATCH_ACTION_TYPES as readonly string[]).includes(type)) {
    throw badRequest(`action.type must be one of ${MATCH_ACTION_TYPES.join(', ')}.`)
  }
  switch (type as MatchActionType) {
    case 'submit':
      return { type: 'submit', entry: expectString(action.entry, 'action.entry', 64) }
    case 'undo':
      return { type: 'undo' }
    case 'resetLeg':
      return { type: 'resetLeg' }
    case 'nextLeg':
      return { type: 'nextLeg' }
    case 'rewind':
      return {
        type: 'rewind',
        legId: expectString(action.legId, 'action.legId', 100),
        visitIndex: expectInteger(action.visitIndex, 'action.visitIndex', 0, 1_000_000),
      }
  }
}

/** Players in the match, its creator and the room owner may score (while it is live). */
function isScorer(view: MatchView, userId: string) {
  return view.players.some((player) => player.userId === userId) || view.row.created_by === userId || view.roomOwnerId === userId
}

function conflict(view: MatchView, viewerId: string): ApiException {
  const response: Omit<MatchConflictResponse, 'error' | 'message'> = { match: matchDetail(view, viewerId) }
  return new ApiException(409, 'conflict', 'The match changed on another device. It has been refreshed.', response)
}

export function matchRoutes(services: Services) {
  const { db } = services
  const app = new Hono<AppEnv>()

  app.post('/rooms/:roomId/matches', async (c) => {
    const user = requireUser(c)
    const roomId = requireRoom(db, c.req.param('roomId'), user.id).id
    const body = expectObject(await readJson(c))
    const players = parsePlayers(body.players)
    const settings = parseSettings(body.settings)

    const matchId = db.transaction(() => {
      requireRoom(db, roomId, user.id) // membership may have changed while the body was read
      const live = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM matches WHERE room_id = ? AND status = 'live'", roomId)?.count ?? 0
      if (live >= MAX_LIVE_MATCHES_PER_ROOM) throw badRequest(`A room can have at most ${MAX_LIVE_MATCHES_PER_ROOM} live matches. Finish or delete one first.`)

      const roster = players.map((player) => {
        if ('guestName' in player) return { userId: null, name: player.guestName }
        const member = db.get<Pick<UserRow, 'id' | 'name'>>(
          'SELECT u.id, u.name FROM room_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ? AND m.user_id = ?',
          roomId, player.userId,
        )
        if (!member) throw badRequest('Every signed-in player must be a member of this room.')
        return { userId: member.id, name: member.name }
      })

      const state = createGameState({
        game: settings.game,
        doubleIn: settings.doubleIn,
        doubleOut: settings.doubleOut,
        legsToWin: settings.legsToWin,
        players: roster.map((player, slot) => ({ id: `slot-${slot}`, name: player.name })),
      })
      const id = randomId()
      const now = nowIso(services)
      db.run(
        `INSERT INTO matches (id, room_id, created_by, status, settings, state, version, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'live', ?, ?, 1, ?, ?, NULL)`,
        id, roomId, user.id, JSON.stringify(settings), JSON.stringify(state), now, now,
      )
      roster.forEach((player, slot) => {
        db.run('INSERT INTO match_players (match_id, slot, user_id, name) VALUES (?, ?, ?, ?)', id, slot, player.userId, player.name)
      })
      return id
    })

    publishMatch(services, matchId)
    const { match } = requireMatchRow(db, matchId, user.id)
    return c.json<MatchResponse>({ match: matchDetail(buildMatchView(db, match), user.id) }, 201)
  })

  app.get('/matches/:matchId', (c) => {
    const user = requireUser(c)
    const { match } = requireMatchRow(db, c.req.param('matchId'), user.id)
    return c.json<MatchResponse>({ match: matchDetail(buildMatchView(db, match), user.id) })
  })

  /** Loads the match and checks it can be changed by `userId` at `baseVersion` (synchronously). */
  const loadForScoring = (matchId: string | undefined, userId: string, baseVersion: number) => {
    const { match } = requireMatchRow(db, matchId, userId)
    const view = buildMatchView(db, match)
    if (!isScorer(view, userId)) throw forbidden('Only the players, the match creator and the room owner can score this match.')
    if (baseVersion !== match.version) throw conflict(view, userId)
    if (match.status !== 'live') throw badRequest('This match is already finished.')
    return view
  }

  app.post('/matches/:matchId/actions', async (c) => {
    const user = requireUser(c)
    const matchId = c.req.param('matchId')
    requireMatchRow(db, matchId, user.id)
    const body = expectObject(await readJson(c))
    const baseVersion = expectInteger(body.baseVersion, 'baseVersion', 0)
    const action = parseAction(body.action)

    // From here on everything is synchronous: no other request can interleave.
    const view = loadForScoring(matchId, user.id, baseVersion)
    if (action.type === 'submit') {
      const { error } = evaluateOnlineEntry(action.entry, view.state.currentVisit.length)
      if (error) throw badRequest(error)
    }
    const next = gameReducer(view.state, action)
    if (next === view.state) return c.json<MatchResponse>({ match: matchDetail(view, user.id) })

    const state = JSON.stringify(next)
    if (state.length > MAX_STATE_BYTES) throw badRequest('This match has grown too long to record more darts.')
    const now = nowIso(services)
    db.run(
      'UPDATE matches SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
      state, now, view.row.id, view.row.version,
    )
    const updated: MatchRow = { ...view.row, state, version: view.row.version + 1, updated_at: now }
    publishMatch(services, view.row.id)
    return c.json<MatchResponse>({ match: matchDetail(buildMatchView(db, updated), user.id) })
  })

  app.post('/matches/:matchId/finish', async (c) => {
    const user = requireUser(c)
    const matchId = c.req.param('matchId')
    requireMatchRow(db, matchId, user.id)
    const body = expectObject(await readJson(c))
    const baseVersion = expectInteger(body.baseVersion, 'baseVersion', 0)

    const view = loadForScoring(matchId, user.id, baseVersion)
    const { state, row } = view
    if (state.matchWinner === null) throw badRequest('The match has no winner yet.')

    const stats = computePlayerStats(state, { includeCurrentLeg: false })
    const placings = matchPlacings(state)
    const now = nowIso(services)
    db.transaction(() => {
      for (const player of view.players) {
        const s = stats[player.slot]
        db.run(
          `INSERT INTO match_results (
             match_id, slot, room_id, user_id, placing, won,
             legs_won, legs_played, darts, points, visits, first9_points, first9_darts,
             scores_180, scores_140, scores_100, checkout_attempts, checkouts, highest_checkout, best_leg_darts,
             rating_before, rating_after, completed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
          row.id, player.slot, row.room_id, player.userId, placings[player.slot], state.matchWinner === player.slot ? 1 : 0,
          s.legsWon, s.legsPlayed, s.darts, s.points, s.visits, s.first9Points, s.first9Darts,
          s.scores180, s.scores140, s.scores100, s.checkoutAttempts, s.checkouts, s.highestCheckout, s.bestLegDarts,
          now,
        )
      }
      db.run(
        "UPDATE matches SET status = 'completed', version = version + 1, updated_at = ?, completed_at = ? WHERE id = ?",
        now, now, row.id,
      )
      recomputeRoomRatings(db, row.room_id)
    })

    publishMatch(services, row.id)
    const { match } = requireMatchRow(db, row.id, user.id)
    return c.json<MatchResponse>({ match: matchDetail(buildMatchView(db, match), user.id) })
  })

  app.delete('/matches/:matchId', (c) => {
    const user = requireUser(c)
    const { match } = requireMatchRow(db, c.req.param('matchId'), user.id)
    const view = buildMatchView(db, match)
    if (!matchDetail(view, user.id).canDelete) {
      throw forbidden(match.status === 'live'
        ? 'Only the match creator or the room owner can delete a live match.'
        : 'Only the room owner can delete a completed match.')
    }
    db.transaction(() => {
      db.run('DELETE FROM matches WHERE id = ?', match.id)
      if (match.status === 'completed') recomputeRoomRatings(db, match.room_id)
    })
    publishMatchDeleted(services, match.id, match.room_id)
    return c.body(null, 204)
  })

  app.get('/matches/:matchId/events', (c) => {
    const user = requireUser(c)
    const { match } = requireMatchRow(db, c.req.param('matchId'), user.id)
    const initial: MatchEvent = { match: matchDetail(buildMatchView(db, match), user.id) }
    return openEventStream(c, services, user.id, { kind: 'match', matchId: match.id, roomId: match.room_id }, { event: 'match', data: initial })
  })

  return app
}
