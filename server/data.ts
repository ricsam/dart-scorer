import { computePlayerStats, finalizePlayerStats, matchPlacings, type GameState, type PlayerStats } from '../src/game'
import type {
  MatchDetail,
  MatchPlayer,
  MatchResult,
  MatchSettings,
  MatchStatus,
  MatchSummary,
  MemberRole,
  RoomMember,
  UserRef,
} from '../src/shared/api'
import type { UserRow } from './context'
import type { Db } from './db'
import { notFound } from './http'
import { displayRating, INITIAL_RATING, roomRatings } from './ratings'
import { toUserRef } from './users'

// ── Rows ────────────────────────────────────────────────────────────────────

export type RoomRow = {
  id: string
  name: string
  owner_id: string
  invite_code: string
  created_at: string
  updated_at: string
}

export type MatchRow = {
  id: string
  room_id: string
  created_by: string
  status: MatchStatus
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
  room_id: string
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

export type RoomAccess = RoomRow & { role: MemberRole }

export function roomAccess(db: Db, roomId: string, userId: string): RoomAccess | undefined {
  return db.get<RoomAccess>(
    'SELECT r.*, m.role AS role FROM rooms r JOIN room_members m ON m.room_id = r.id AND m.user_id = ? WHERE r.id = ?',
    userId, roomId,
  )
}

/** The room if the user is a current member; otherwise 404 (rooms you can't see don't exist). */
export function requireRoom(db: Db, roomId: string | undefined, userId: string): RoomAccess {
  const room = roomId ? roomAccess(db, roomId, userId) : undefined
  if (!room) throw notFound('Room not found.')
  return room
}

export function requireMatchRow(db: Db, matchId: string | undefined, userId: string): { match: MatchRow; room: RoomAccess } {
  const match = matchId ? db.get<MatchRow>('SELECT * FROM matches WHERE id = ?', matchId) : undefined
  const room = match ? roomAccess(db, match.room_id, userId) : undefined
  if (!match || !room) throw notFound('Match not found.')
  return { match, room }
}

export function memberRows(db: Db, roomId: string) {
  return db.all<Pick<UserRow, 'id' | 'name' | 'avatar_url' | 'is_guest' | 'claimed'> & { role: MemberRole; joined_at: string }>(
    `SELECT u.id, u.name, u.avatar_url, u.is_guest, u.claimed, m.role, m.joined_at
     FROM room_members m JOIN users u ON u.id = m.user_id
     WHERE m.room_id = ? ORDER BY m.joined_at, m.rowid`,
    roomId,
  )
}

export function roomMembers(db: Db, roomId: string): RoomMember[] {
  const ratings = roomRatings(db, roomId)
  return memberRows(db, roomId).map((row) => {
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
  createdBy: UserRef
  roomName: string
  roomOwnerId: string
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
  const players = db.all<{ slot: number; user_id: string | null; guest_id: string | null; bot_id: string | null; name: string; avatar_url: string | null }>(
    `SELECT p.slot, p.user_id, p.guest_id, p.bot_id, p.name, u.avatar_url
     FROM match_players p LEFT JOIN users u ON u.id = p.user_id
     WHERE p.match_id = ? ORDER BY p.slot`,
    row.id,
  ).map((player): MatchPlayer => ({
    slot: player.slot,
    userId: player.user_id,
    guestId: player.guest_id,
    botId: player.bot_id,
    name: player.name,
    avatarUrl: player.user_id ? player.avatar_url : null,
    guest: player.user_id === null && player.bot_id === null,
  }))
  const room = db.get<{ name: string; owner_id: string }>('SELECT name, owner_id FROM rooms WHERE id = ?', row.room_id)
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
    createdBy: userRef(db, row.created_by),
    roomName: room?.name ?? '',
    roomOwnerId: room?.owner_id ?? '',
    results,
  }
}

export function loadMatchView(db: Db, matchId: string): MatchView | undefined {
  const row = db.get<MatchRow>('SELECT * FROM matches WHERE id = ?', matchId)
  return row ? buildMatchView(db, row) : undefined
}

export function canScore(view: MatchView, viewerId: string) {
  return view.row.status === 'live' && (
    view.players.some((player) => player.userId === viewerId || player.guestId === viewerId)
    || view.row.created_by === viewerId
    || view.roomOwnerId === viewerId
  )
}

export function canDelete(view: MatchView, viewerId: string) {
  return view.row.status === 'live'
    ? view.row.created_by === viewerId || view.roomOwnerId === viewerId
    : view.roomOwnerId === viewerId
}

export function matchSummary(view: MatchView): MatchSummary {
  const { row, state } = view
  const live = row.status === 'live'
  const stats = computePlayerStats(state)
  const placings = matchPlacings(state)
  return {
    id: row.id,
    roomId: row.room_id,
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

export function matchDetail(view: MatchView, viewerId: string): MatchDetail {
  const { row } = view
  return {
    id: row.id,
    roomId: row.room_id,
    roomName: view.roomName,
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
    canDelete: canDelete(view, viewerId),
    results: view.results,
  }
}

export function summarize(db: Db, rows: MatchRow[]): MatchSummary[] {
  return rows.map((row) => matchSummary(buildMatchView(db, row)))
}
