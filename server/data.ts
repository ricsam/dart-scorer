import { computePlayerStats, finalizePlayerStats, matchPlacings, type GameState, type PlayerStats } from '../src/game'
import type {
  MatchDetail,
  MatchPlayer,
  MatchResult,
  MatchSettings,
  MatchStatus,
  MatchSummary,
  MemberRole,
  LeagueMember,
  UserRef,
} from '../src/shared/api'
import type { UserRow } from './context'
import type { Db } from './db'
import { notFound } from './http'
import { AUTO_SAVE_AFTER_MS, CLAIM_AFTER_MS } from './match-limits'
import { displayRating, INITIAL_RATING, leagueRatings } from './ratings'
import { toUserRef } from './users'

// ── Rows ────────────────────────────────────────────────────────────────────

export type LeagueRow = {
  id: string
  name: string
  owner_id: string
  invite_code: string
  created_at: string
  updated_at: string
}

/** `league` matches belong to a league; lobby matches are `public` or `private` (the lobby's visibility at start). */
export type MatchVisibility = 'league' | 'public' | 'private'

export type MatchRow = {
  id: string
  league_id: string | null
  lobby_id: string | null
  visibility: MatchVisibility
  created_by: string
  status: MatchStatus
  ranked: number
  practice: number
  forfeit_slot: number | null
  settings: string
  state: string
  version: number
  created_at: string
  updated_at: string
  completed_at: string | null
}

export type ResultRow = {
  match_id: string
  slot: number
  league_id: string | null
  user_id: string | null
  placing: number
  won: number
  legs_won: number
  legs_played: number
  darts: number
  points: number
  visits: number
  first9_points: number
  first9_darts: number
  scores_180: number
  scores_140: number
  scores_100: number
  checkout_attempts: number
  checkouts: number
  highest_checkout: number
  best_leg_darts: number | null
  rating_before: number | null
  rating_after: number | null
  completed_at: string
}

export const DEFAULT_SETTINGS: MatchSettings = { game: 501, doubleIn: false, doubleOut: true, legsToWin: 3 }

// ── Membership ──────────────────────────────────────────────────────────────

export type LeagueAccess = LeagueRow & { role: MemberRole }

export function leagueAccess(db: Db, leagueId: string, userId: string): LeagueAccess | undefined {
  return db.get<LeagueAccess>(
    'SELECT r.*, m.role AS role FROM leagues r JOIN league_members m ON m.league_id = r.id AND m.user_id = ? WHERE r.id = ?',
    userId, leagueId,
  )
}

/** The league if the user is a current member; otherwise 404 (leagues you can't see don't exist). */
export function requireLeague(db: Db, leagueId: string | undefined, userId: string): LeagueAccess {
  const league = leagueId ? leagueAccess(db, leagueId, userId) : undefined
  if (!league) throw notFound('League not found.')
  return league
}

/**
 * Who may watch a match: league members for league matches; for lobby matches the players,
 * whoever scores for a slot, current members of its lobby, and any signed-in player when the
 * lobby was public.
 */
export function canViewMatch(db: Db, match: MatchRow, userId: string) {
  if (match.visibility === 'league') return match.league_id !== null && leagueAccess(db, match.league_id, userId) !== undefined
  if (match.visibility === 'public' || match.created_by === userId) return true
  if (db.get('SELECT 1 FROM match_players WHERE match_id = ? AND (user_id = ? OR controller_id = ?)', match.id, userId, userId)) return true
  return match.lobby_id !== null && db.get('SELECT 1 FROM lobby_players WHERE lobby_id = ? AND user_id = ?', match.lobby_id, userId) !== undefined
}

export function requireMatchRow(db: Db, matchId: string | undefined, userId: string): { match: MatchRow; league: LeagueAccess | null } {
  const match = matchId ? db.get<MatchRow>('SELECT * FROM matches WHERE id = ?', matchId) : undefined
  if (!match || !canViewMatch(db, match, userId)) throw notFound('Match not found.')
  return { match, league: match.league_id ? leagueAccess(db, match.league_id, userId) ?? null : null }
}

export function memberRows(db: Db, leagueId: string) {
  return db.all<Pick<UserRow, 'id' | 'name' | 'avatar_url' | 'is_guest' | 'claimed'> & { role: MemberRole; joined_at: string }>(
    `SELECT u.id, u.name, u.avatar_url, u.is_guest, u.claimed, m.role, m.joined_at
     FROM league_members m JOIN users u ON u.id = m.user_id
     WHERE m.league_id = ? ORDER BY m.joined_at, m.rowid`,
    leagueId,
  )
}

export function leagueMembers(db: Db, leagueId: string): LeagueMember[] {
  const ratings = leagueRatings(db, leagueId)
  return memberRows(db, leagueId).map((row) => {
    const rating = ratings.get(row.id)
    return {
      ...toUserRef(row),
      guest: row.is_guest === 1,
      claimed: row.is_guest !== 1 || row.claimed === 1,
      role: row.role,
      joinedAt: row.joined_at,
      rating: displayRating(rating?.rating ?? INITIAL_RATING),
      matches: rating?.matches ?? 0,
    }
  })
}

export function userRef(db: Db, userId: string): UserRef {
  const row = db.get<Pick<UserRow, 'id' | 'name' | 'avatar_url'>>('SELECT id, name, avatar_url FROM users WHERE id = ?', userId)
  return row ? toUserRef(row) : { id: userId, name: 'Unknown player', avatarUrl: null }
}

// ── Matches ─────────────────────────────────────────────────────────────────

/** Everything needed to render a match for any viewer. */
export type MatchView = {
  row: MatchRow
  state: GameState
  settings: MatchSettings
  players: MatchPlayer[]
  /** Per slot: the account that enters darts for it in a lobby match (null for bots and league matches). */
  controllers: (string | null)[]
  createdBy: UserRef
  leagueName: string | null
  leagueOwnerId: string | null
  /** Current members of the lobby the match was started from, if it still exists. */
  lobbyMemberIds: Set<string>
  results: MatchResult[] | null
}

export function resultStats(row: ResultRow): PlayerStats {
  return finalizePlayerStats({
    legsWon: row.legs_won,
    legsPlayed: row.legs_played,
    darts: row.darts,
    points: row.points,
    visits: row.visits,
    average: 0,
    first9Points: row.first9_points,
    first9Darts: row.first9_darts,
    first9Average: 0,
    scores180: row.scores_180,
    scores140: row.scores_140,
    scores100: row.scores_100,
    checkoutAttempts: row.checkout_attempts,
    checkouts: row.checkouts,
    checkoutRate: null,
    highestCheckout: row.highest_checkout,
    bestLegDarts: row.best_leg_darts,
  })
}

export function buildMatchView(db: Db, row: MatchRow): MatchView {
  const rows = db.all<{ slot: number; user_id: string | null; guest_id: string | null; bot_id: string | null; controller_id: string | null; name: string; avatar_url: string | null }>(
    `SELECT p.slot, p.user_id, p.guest_id, p.bot_id, p.controller_id, p.name, u.avatar_url
     FROM match_players p LEFT JOIN users u ON u.id = p.user_id
     WHERE p.match_id = ? ORDER BY p.slot`,
    row.id,
  )
  const players = rows.map((player): MatchPlayer => ({
    slot: player.slot,
    userId: player.user_id,
    guestId: player.guest_id,
    botId: player.bot_id,
    name: player.name,
    avatarUrl: player.user_id ? player.avatar_url : null,
    guest: player.user_id === null && player.bot_id === null,
  }))
  const league = row.league_id ? db.get<{ name: string; owner_id: string }>('SELECT name, owner_id FROM leagues WHERE id = ?', row.league_id) : undefined
  const lobbyMemberIds = new Set(row.lobby_id
    ? db.all<{ user_id: string }>('SELECT user_id FROM lobby_players WHERE lobby_id = ? AND user_id IS NOT NULL', row.lobby_id).map((member) => member.user_id)
    : [])
  const results = row.status === 'completed'
    ? db.all<ResultRow>('SELECT * FROM match_results WHERE match_id = ? ORDER BY slot', row.id).map((result): MatchResult => ({
      slot: result.slot,
      placing: result.placing,
      won: result.won === 1,
      stats: resultStats(result),
      ratingBefore: result.rating_before === null ? null : displayRating(result.rating_before),
      ratingAfter: result.rating_after === null ? null : displayRating(result.rating_after),
    }))
    : null
  return {
    row,
    state: JSON.parse(row.state) as GameState,
    settings: JSON.parse(row.settings) as MatchSettings,
    players,
    controllers: rows.map((player) => player.controller_id),
    createdBy: userRef(db, row.created_by),
    leagueName: league?.name ?? null,
    leagueOwnerId: league?.owner_id ?? null,
    lobbyMemberIds,
    results,
  }
}

export function loadMatchView(db: Db, matchId: string): MatchView | undefined {
  const row = db.get<MatchRow>('SELECT * FROM matches WHERE id = ?', matchId)
  return row ? buildMatchView(db, row) : undefined
}

const isLobbyMatch = (view: MatchView) => view.row.visibility !== 'league'
const humanSlots = (view: MatchView) => view.players.filter((player) => !player.botId).map((player) => player.slot)

/** League scorers: the match's players, its creator and the league owner (trusted friends). */
function isLeagueScorer(view: MatchView, viewerId: string) {
  return view.players.some((player) => player.userId === viewerId || player.guestId === viewerId)
    || view.row.created_by === viewerId
    || view.leagueOwnerId === viewerId
}

/** Slots the viewer may enter darts for while the match is live. */
export function controlledSlots(view: MatchView, viewerId: string): number[] {
  if (view.row.status !== 'live') return []
  return scorerSlots(view, viewerId)
}

/** Slots the viewer scores, regardless of whether the match is still live. */
function scorerSlots(view: MatchView, viewerId: string): number[] {
  if (!isLobbyMatch(view)) return isLeagueScorer(view, viewerId) ? humanSlots(view) : []
  return humanSlots(view).filter((slot) => view.controllers[slot] === viewerId)
}

/** Players (or their scorers) of a match, live or finished: they get conflict responses rather than 403s. */
export function isScorer(view: MatchView, viewerId: string) {
  return scorerSlots(view, viewerId).length > 0
}

export function canScore(view: MatchView, viewerId: string) {
  return controlledSlots(view, viewerId).length > 0
}

/** Restarting a leg or rewinding changes everyone's darts: only for whoever scores every human slot. */
export function canResetLeg(view: MatchView, viewerId: string) {
  const controlled = controlledSlots(view, viewerId)
  return controlled.length > 0 && humanSlots(view).every((slot) => controlled.includes(slot))
}

/** Account players on separate devices: concede and inactivity claims replace abandoning. */
export function isOnlineDuel(view: MatchView) {
  return isLobbyMatch(view) && new Set(view.players.flatMap((player) => player.userId ? [player.userId] : [])).size >= 2
}

export function canConcede(view: MatchView, viewerId: string) {
  return view.row.status === 'live' && isOnlineDuel(view) && view.state.matchWinner === null
    && view.players.some((player) => player.userId === viewerId)
}

/** The active account opponent can be claimed after a period without any change to the match. */
export function claimFor(view: MatchView, viewerId: string): { slot: number; at: string } | null {
  if (!canConcede(view, viewerId) || view.state.winner !== null) return null
  const active = view.players[view.state.active]
  if (!active?.userId || active.userId === viewerId) return null
  return { slot: active.slot, at: new Date(Date.parse(view.row.updated_at) + CLAIM_AFTER_MS).toISOString() }
}

export function autoSaveAt(view: MatchView) {
  if (!isLobbyMatch(view) || view.row.status !== 'live' || view.state.matchWinner === null) return null
  return new Date(Date.parse(view.row.updated_at) + AUTO_SAVE_AFTER_MS).toISOString()
}

export function canDelete(view: MatchView, viewerId: string) {
  if (isLobbyMatch(view)) {
    // Ranked games end by result, concession or inactivity claim; practice can be cleaned up by its owner.
    return view.row.created_by === viewerId && (view.row.status === 'live' ? view.row.ranked === 0 : view.row.practice === 1)
  }
  return view.row.status === 'live'
    ? view.row.created_by === viewerId || view.leagueOwnerId === viewerId
    : view.leagueOwnerId === viewerId
}

/** League members chat in a league match; lobby matches use the lobby chat (players and lobby members). */
export function canChat(view: MatchView, viewerId: string) {
  if (!isLobbyMatch(view)) return view.leagueOwnerId !== null
  return view.lobbyMemberIds.has(viewerId)
    || view.players.some((player) => player.userId === viewerId)
    || view.controllers.includes(viewerId)
}

export function matchContext(row: MatchRow) {
  return {
    leagueId: row.league_id,
    lobbyId: row.lobby_id,
    ranked: row.ranked === 1,
    practice: row.practice === 1,
    forfeitSlot: row.forfeit_slot,
  }
}

export function matchSummary(view: MatchView): MatchSummary {
  const { row, state } = view
  const live = row.status === 'live'
  const stats = computePlayerStats(state)
  const placings = matchPlacings(state)
  return {
    id: row.id,
    ...matchContext(row),
    status: row.status,
    settings: view.settings,
    players: view.players.map((player) => ({
      ...player,
      legs: state.players[player.slot]?.legs ?? 0,
      score: state.players[player.slot]?.score ?? 0,
      average: stats[player.slot]?.average ?? 0,
      won: !live && (view.results
        ? view.results.some((result) => result.slot === player.slot && result.won)
        : placings[player.slot] === 1),
    })),
    active: live ? state.active : null,
    awaitingConfirmation: live && state.matchWinner !== null,
    createdBy: view.createdBy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

export function matchDetail(view: MatchView, viewerId: string, isOnline: (userId: string) => boolean = () => false): MatchDetail {
  const { row } = view
  return {
    id: row.id,
    ...matchContext(row),
    leagueName: view.leagueName,
    status: row.status,
    settings: view.settings,
    players: view.players,
    state: view.state,
    version: row.version,
    createdBy: view.createdBy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    canScore: canScore(view, viewerId),
    controlledSlots: controlledSlots(view, viewerId),
    canResetLeg: canResetLeg(view, viewerId),
    canDelete: canDelete(view, viewerId),
    canConcede: canConcede(view, viewerId),
    claim: claimFor(view, viewerId),
    autoSaveAt: autoSaveAt(view),
    onlineUserIds: [...new Set(view.players.flatMap((player) => player.userId && isOnline(player.userId) ? [player.userId] : []))],
    canChat: canChat(view, viewerId),
    results: view.results,
  }
}

export function summarize(db: Db, rows: MatchRow[]): MatchSummary[] {
  return rows.map((row) => matchSummary(buildMatchView(db, row)))
}
