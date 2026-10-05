import { Hono } from 'hono'
import {
  evaluateOnlineEntry,
  createGameState,
  GAMES,
  MATCH_ACTION_TYPES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_NAME_MAX_LENGTH,
  type GameAction,
} from '../src/game'
import type { MatchConflictResponse, MatchEvent, MatchesResponse, MatchResponse, MatchSettings, CreateMatchRequest, MyMatchesResponse } from '../src/shared/api'
import { getBot } from '../src/shared/bots'
import { reduceMatchAction, undoTargetSlot } from '../src/shared/match-reducer'
import { MAX_STATE_BYTES } from './match-limits'
export { MAX_STATE_BYTES } from './match-limits'
import { requireUser } from './auth'
import type { AppEnv, Services, UserRow } from './context'
import { nowIso } from './context'
import {
  buildMatchView,
  canResetLeg,
  claimFor,
  canConcede,
  controlledSlots,
  isScorer,
  matchDetail,
  matchSummary,
  requireMatchRow,
  requireLeague,
  type MatchRow,
  type MatchView,
  type MatchVisibility,
} from './data'
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
import { ensureGuest } from './guests'
import { randomId } from './ids'
import { recomputeLeagueRatings } from './ratings'
import { saveMatchResult } from './results'

export const MAX_LIVE_MATCHES_PER_LEAGUE = 10
export const MAX_LEGS_TO_WIN = 11

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

type PlayerInput = CreateMatchRequest['players'][number]

export function parsePlayers(value: unknown): PlayerInput[] {
  if (!Array.isArray(value)) throw badRequest('players must be an array.')
  if (value.length < MIN_PLAYERS || value.length > MAX_PLAYERS) throw badRequest(`A match needs ${MIN_PLAYERS}–${MAX_PLAYERS} players.`)
  if (value.every((item) => isObject(item) && item.botId !== undefined)) throw badRequest('A match needs at least one human player.')
  const seen = new Set<string>()
  return value.map((item, index): PlayerInput => {
    if (!isObject(item)) throw badRequest(`players[${index}] must be an object.`)
    const hasUser = item.userId !== undefined
    const hasGuest = item.guestName !== undefined
    const hasGuestId = item.guestId !== undefined
    const hasBot = item.botId !== undefined
    if (Number(hasUser) + Number(hasGuest) + Number(hasGuestId) + Number(hasBot) !== 1) throw badRequest(`players[${index}] needs exactly one of userId, guestId, guestName or botId.`)
    if (hasBot) {
      if (typeof item.botId !== 'string' || !getBot(item.botId)) throw badRequest('Choose a bot from the house roster.')
      return { botId: item.botId }
    }
    if (hasGuestId) {
      if (typeof item.guestId !== 'string' || !validId(item.guestId)) throw badRequest('guestId is not valid.')
      return { guestId: item.guestId }
    }
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

export type RosterEntry = { userId: string | null; guestId: string | null; botId: string | null; controllerId: string | null; name: string }

export type NewMatch = {
  leagueId: string | null
  lobbyId: string | null
  visibility: MatchVisibility
  createdBy: string
  ranked: boolean
  settings: MatchSettings
  roster: RosterEntry[]
}

/** Inserts a live match and its players. Call inside the caller's transaction; publish afterwards. */
export function insertMatch(services: Services, input: NewMatch) {
  const { db } = services
  const { settings, roster } = input
  const state = createGameState({
    game: settings.game,
    doubleIn: settings.doubleIn,
    doubleOut: settings.doubleOut,
    legsToWin: settings.legsToWin,
    players: roster.map((player, slot) => ({ id: `slot-${slot}`, name: player.name })),
  })
  // Solo and bot games are practice: separate statistics, never wins, losses or ratings.
  const practice = roster.length === 1 || roster.some((player) => player.botId)
  const id = randomId()
  const now = nowIso(services)
  db.run(
    `INSERT INTO matches (id, league_id, lobby_id, visibility, created_by, status, ranked, practice, settings, state, version, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, 'live', ?, ?, ?, ?, 1, ?, ?, NULL)`,
    id, input.leagueId, input.lobbyId, input.visibility, input.createdBy, input.ranked && !practice ? 1 : 0, practice ? 1 : 0,
    JSON.stringify(settings), JSON.stringify(state), now, now,
  )
  roster.forEach((player, slot) => {
    db.run(
      'INSERT INTO match_players (match_id, slot, user_id, guest_id, bot_id, controller_id, name) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, slot, player.userId, player.guestId, player.botId, player.controllerId, player.name,
    )
  })
  return id
}

export function matchConflict(view: MatchView, viewerId: string, isOnline?: (userId: string) => boolean): ApiException {
  const response: Omit<MatchConflictResponse, 'error' | 'message'> = { match: matchDetail(view, viewerId, isOnline) }
  return new ApiException(409, 'conflict', 'The match changed on another device. It has been refreshed.', response)
}

/**
 * League matches trust every scorer with every human slot. In lobby matches, where opponents may
 * be strangers on their own devices, you enter and undo only your own darts, and restarting a
 * leg or rewinding needs control of every human slot.
 */
function authorizeAction(view: MatchView, userId: string, action: GameAction) {
  const controlled = controlledSlots(view, userId)
  if (view.row.visibility === 'league') return
  const owner = (slot: number) => view.players[slot]?.name ?? 'another player'
  switch (action.type) {
    case 'submit':
      if (!controlled.includes(view.state.active)) throw forbidden(`It's ${owner(view.state.active)}'s turn. They enter their own darts.`)
      return
    case 'undo': {
      const target = undoTargetSlot(view.state, view.players)
      if (target !== null && !controlled.includes(target)) throw forbidden(`The last darts belong to ${owner(target)}. Only they can undo them.`)
      return
    }
    case 'resetLeg':
    case 'rewind':
      if (!canResetLeg(view, userId)) throw forbidden('Restarting a leg or rewinding needs every player\'s agreement: undo your own darts instead.')
      return
    default:
      return
  }
}

export function matchRoutes(services: Services) {
  const { db, hub } = services
  const app = new Hono<AppEnv>()
  const isOnline = (userId: string) => hub.isOnline(userId)
  const detail = (view: MatchView, userId: string) => matchDetail(view, userId, isOnline)

  app.post('/leagues/:leagueId/matches', async (c) => {
    const user = requireUser(c)
    const leagueId = requireLeague(db, c.req.param('leagueId'), user.id).id
    const body = expectObject(await readJson(c))
    const players = parsePlayers(body.players)
    const settings = parseSettings(body.settings)

    const matchId = db.transaction(() => {
      requireLeague(db, leagueId, user.id) // membership may have changed while the body was read
      const live = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM matches WHERE league_id = ? AND status = 'live'", leagueId)?.count ?? 0
      if (live >= MAX_LIVE_MATCHES_PER_LEAGUE) throw badRequest(`A league can have at most ${MAX_LIVE_MATCHES_PER_LEAGUE} live matches. Finish or delete one first.`)

      const roster = players.map((player): RosterEntry => {
        if ('botId' in player) {
          const bot = getBot(player.botId)!
          return { userId: null, guestId: null, botId: bot.id, controllerId: null, name: bot.name }
        }
        if ('guestName' in player) {
          const guest = ensureGuest(services, leagueId, player.guestName)
          return { userId: null, guestId: guest.id, botId: null, controllerId: null, name: guest.name }
        }
        const guestInput = 'guestId' in player
        const member = db.get<UserRow>(
          'SELECT u.* FROM league_members m JOIN users u ON u.id = m.user_id WHERE m.league_id = ? AND m.user_id = ?',
          leagueId, guestInput ? player.guestId : player.userId,
        )
        if (!member || Boolean(member.is_guest) !== guestInput || (guestInput && member.guest_league_id !== leagueId)) throw badRequest('Every player must be a member of this league with the correct identity type.')
        return { userId: guestInput ? null : member.id, guestId: guestInput ? member.id : null, botId: null, controllerId: null, name: member.name }
      })
      if (new Set(roster.map((player) => player.botId ? `bot:${player.botId}` : player.userId ?? player.guestId)).size !== roster.length) throw badRequest('A player can only be added once.')
      return insertMatch(services, { leagueId, lobbyId: null, visibility: 'league', createdBy: user.id, ranked: false, settings, roster })
    })

    publishMatch(services, matchId)
    const { match } = requireMatchRow(db, matchId, user.id)
    return c.json<MatchResponse>({ match: detail(buildMatchView(db, match), user.id) }, 201)
  })

  app.get('/matches/:matchId', (c) => {
    const user = requireUser(c)
    const { match } = requireMatchRow(db, c.req.param('matchId'), user.id)
    return c.json<MatchResponse>({ match: detail(buildMatchView(db, match), user.id) })
  })

  /** Loads the match and checks it can be changed by `userId` at `baseVersion` (synchronously). */
  const loadForScoring = (matchId: string | undefined, userId: string, baseVersion: number) => {
    const { match } = requireMatchRow(db, matchId, userId)
    const view = buildMatchView(db, match)
    if (!isScorer(view, userId)) {
      throw forbidden(match.visibility === 'league'
        ? 'Only the players, the match creator and the league owner can score this match.'
        : 'Only the players in this match can score it.')
    }
    if (baseVersion !== match.version) throw matchConflict(view, userId, isOnline)
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
      if (view.players[view.state.active]?.botId) throw badRequest('Bots throw their own darts. Wait for a human turn.')
      const { error } = evaluateOnlineEntry(action.entry, view.state.currentVisit.length)
      if (error) throw badRequest(error)
    }
    authorizeAction(view, user.id, action)
    const next = reduceMatchAction(view.state, action, view.players)
    if (next === view.state) return c.json<MatchResponse>({ match: detail(view, user.id) })

    const state = JSON.stringify(next)
    if (state.length > MAX_STATE_BYTES) throw badRequest('This match has grown too long to record more darts.')
    const now = nowIso(services)
    db.run(
      'UPDATE matches SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
      state, now, view.row.id, view.row.version,
    )
    const updated: MatchRow = { ...view.row, state, version: view.row.version + 1, updated_at: now }
    publishMatch(services, view.row.id)
    return c.json<MatchResponse>({ match: detail(buildMatchView(db, updated), user.id) })
  })

  app.post('/matches/:matchId/finish', async (c) => {
    const user = requireUser(c)
    const matchId = c.req.param('matchId')
    requireMatchRow(db, matchId, user.id)
    const body = expectObject(await readJson(c))
    const baseVersion = expectInteger(body.baseVersion, 'baseVersion', 0)

    const view = loadForScoring(matchId, user.id, baseVersion)
    const saved = saveMatchResult(services, view, { reason: 'confirmed' })
    return c.json<MatchResponse>({ match: detail(saved, user.id) })
  })

  app.post('/matches/:matchId/forfeit', async (c) => {
    const user = requireUser(c)
    const matchId = c.req.param('matchId')
    requireMatchRow(db, matchId, user.id)
    const body = expectObject(await readJson(c))
    const baseVersion = expectInteger(body.baseVersion, 'baseVersion', 0)
    const slot = expectInteger(body.slot, 'slot', 0, MAX_PLAYERS - 1)

    const { match } = requireMatchRow(db, matchId, user.id)
    const view = buildMatchView(db, match)
    if (match.status !== 'live') throw badRequest('This match is already finished.')
    if (baseVersion !== match.version) throw matchConflict(view, user.id, isOnline)
    if (!canConcede(view, user.id)) {
      throw forbidden(view.state.matchWinner !== null
        ? 'The match is already decided. Save the result instead.'
        : 'Only players in an online game between accounts can concede or claim a win.')
    }
    const target = view.players[slot]
    if (!target) throw badRequest('slot is not a player in this match.')
    const own = target.userId === user.id
    if (!own) {
      const claim = claimFor(view, user.id)
      if (!claim || claim.slot !== slot) throw forbidden('You can only claim a win from the player at the oche.')
      if (services.now().getTime() < Date.parse(claim.at)) throw badRequest(`${target.name} still has time to throw. You can claim the match after three minutes without activity.`)
    }
    const saved = saveMatchResult(services, view, { forfeitSlot: slot, reason: own ? 'conceded' : 'claimed' })
    return c.json<MatchResponse>({ match: detail(saved, user.id) })
  })

  app.delete('/matches/:matchId', (c) => {
    const user = requireUser(c)
    const { match } = requireMatchRow(db, c.req.param('matchId'), user.id)
    const view = buildMatchView(db, match)
    if (!detail(view, user.id).canDelete) {
      throw forbidden(match.visibility !== 'league'
        ? match.ranked ? 'Ranked games cannot be abandoned. Concede, or claim the win if your opponent stops playing.' : 'Only the lobby leader can abandon this game.'
        : match.status === 'live'
          ? 'Only the match creator or the league owner can delete a live match.'
          : 'Only the league owner can delete a completed match.')
    }
    db.transaction(() => {
      db.run('DELETE FROM matches WHERE id = ?', match.id)
      if (match.status === 'completed' && match.league_id) recomputeLeagueRatings(db, match.league_id)
    })
    publishMatchDeleted(services, match.id, match.league_id, match.lobby_id)
    return c.body(null, 204)
  })

  app.get('/matches/:matchId/events', (c) => {
    const user = requireUser(c)
    const { match } = requireMatchRow(db, c.req.param('matchId'), user.id)
    const initial: MatchEvent = { match: detail(buildMatchView(db, match), user.id) }
    return openEventStream(c, services, user.id, { kind: 'match', matchId: match.id, leagueId: match.league_id, lobbyId: match.lobby_id }, { event: 'match', data: initial })
  })

  app.get('/me/matches', (c) => {
    const user = requireUser(c)
    const status = c.req.query('status') ?? 'live'
    if (status !== 'live') throw badRequest('status must be live.')
    const rows = db.all<MatchRow & { league_name: string | null }>(
      `SELECT m.*, l.name AS league_name FROM matches m LEFT JOIN leagues l ON l.id = m.league_id
       WHERE m.status = 'live'
         AND EXISTS (SELECT 1 FROM match_players p WHERE p.match_id = m.id AND (p.user_id = ? OR p.guest_id = ? OR p.controller_id = ?))
         AND (m.league_id IS NULL OR EXISTS (SELECT 1 FROM league_members lm WHERE lm.league_id = m.league_id AND lm.user_id = ?))
       ORDER BY m.updated_at DESC, m.id DESC LIMIT 20`,
      user.id, user.id, user.id, user.id,
    )
    return c.json<MyMatchesResponse>({
      matches: rows.map(({ league_name: leagueName, ...row }) => ({ ...matchSummary(buildMatchView(db, row)), leagueName })),
    })
  })

  /** Live games from public lobbies that anyone signed in may watch, most recently active first. */
  app.get('/public-matches', (c) => {
    requireUser(c)
    const since = new Date(services.now().getTime() - 30 * 60 * 1000).toISOString()
    const rows = db.all<MatchRow>(
      "SELECT * FROM matches WHERE status = 'live' AND visibility = 'public' AND updated_at >= ? ORDER BY ranked DESC, updated_at DESC, id LIMIT 12",
      since,
    )
    return c.json<MatchesResponse>({ matches: rows.map((row) => matchSummary(buildMatchView(db, row))), hasMore: false })
  })

  return app
}
