/**
 * HTTP contract between the Oche server (`server/`) and the online edition (`src/online/`).
 * Types only — safe to import from both sides.
 *
 * All timestamps are ISO-8601 strings in UTC. Errors use `ApiError` with an HTTP status.
 */
import type { GameAction, GameState, PlayerStats } from '../game'

export type ApiError = {
  error: 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'server_error'
  message: string
}

// ── Users & authentication ──────────────────────────────────────────────────

export type User = {
  id: string
  /** Display name, editable by the user (defaults to the Google given name). */
  name: string
  email: string
  /** A room-scoped player without an account; never ranked. */
  guest: boolean
  avatarUrl: string | null
  createdAt: string
}

export type UserRef = { id: string; name: string; avatarUrl: string | null }

/** GET /api/me */
export type MeResponse = {
  user: User | null
  /** Sign-in methods enabled on this server. `dev` is only for local development and tests. */
  auth: { google: boolean; dev: boolean }
}

/** PATCH /api/me */
export type UpdateMeRequest = { name: string }
export type UpdateMeResponse = { user: User }

/** POST /auth/dev-login — only when the server runs with DEV_LOGIN=true. */
export type DevLoginRequest = { name: string; email: string }

// ── Matches ─────────────────────────────────────────────────────────────────

export type MatchSettings = {
  /** 101, 301, 501 or 701. */
  game: number
  doubleIn: boolean
  doubleOut: boolean
  /** First to this many legs (1–11). */
  legsToWin: number
}

export type MatchStatus = 'live' | 'completed'

export type MatchPlayer = {
  /** Index in `GameState.players`; fixed for the whole match. */
  slot: number
  /** `null` for guests and bots, who are not ranked. */
  userId: string | null
  /** Room guest identity; null for registered players and unlinked legacy guests. */
  guestId: string | null
  /** House bot identity; null for human players. Bots cannot sign in or claim guest slots. */
  botId: string | null
  name: string
  avatarUrl: string | null
  guest: boolean
}

export type MatchPlayerSummary = MatchPlayer & {
  legs: number
  score: number
  /** 3-dart average across the whole match so far. */
  average: number
  won: boolean
}

export type MatchSummary = {
  id: string
  roomId: string
  status: MatchStatus
  settings: MatchSettings
  players: MatchPlayerSummary[]
  /** Slot at the oche for live matches, otherwise null. */
  active: number | null
  /** A live match whose final leg is won but whose result has not been saved yet. */
  awaitingConfirmation: boolean
  createdBy: UserRef
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type MatchResult = {
  slot: number
  /** 1 = match winner; others by legs won, ties share a placing. */
  placing: number
  won: boolean
  stats: PlayerStats
  /** Room rating before/after this match (ranked user players only). */
  ratingBefore: number | null
  ratingAfter: number | null
}

export type MatchDetail = {
  id: string
  roomId: string
  roomName: string
  status: MatchStatus
  settings: MatchSettings
  players: MatchPlayer[]
  state: GameState
  /** Incremented on every accepted action; used for optimistic concurrency. */
  version: number
  createdBy: UserRef
  createdAt: string
  updatedAt: string
  completedAt: string | null
  /** Viewer may enter darts / undo / finish (match players, the creator and the room owner). */
  canScore: boolean
  /** Viewer may delete: live matches by creator or room owner; completed matches by the room owner. */
  canDelete: boolean
  /** Present once completed. */
  results: MatchResult[] | null
}

export type MatchResponse = { match: MatchDetail }

/** POST /api/rooms/:roomId/matches */
export type CreateMatchRequest = {
  /** 2–8 players in throwing order, including at least one human. Named guests create/reuse a room guest. Matches with bots are unranked. */
  players: ({ userId: string } | { guestId: string } | { guestName: string } | { botId: string })[]
  settings: MatchSettings
}

/**
 * POST /api/matches/:matchId/actions
 * Only 'submit' | 'undo' | 'resetLeg' | 'nextLeg' | 'rewind' are accepted for recorded matches.
 * Bots submit server-side only. In bot games, undo discards bot replies and undoes the latest
 * human dart/visit in the current leg (no-op if no human has thrown).
 * Responds 200 `MatchResponse`, or 409 `MatchConflictResponse` when `baseVersion` is stale.
 */
export type MatchActionRequest = { action: GameAction; baseVersion: number }
export type MatchConflictResponse = ApiError & { error: 'conflict'; match: MatchDetail }

/** POST /api/matches/:matchId/finish — saves the result once `state.matchWinner` is set. */
export type FinishMatchRequest = { baseVersion: number }

/** Server-sent event payload on GET /api/matches/:matchId/events (event name `match`). */
export type MatchEvent = { match: MatchDetail }

// ── Rooms ───────────────────────────────────────────────────────────────────

export type MemberRole = 'owner' | 'member'

export type RoomMember = UserRef & {
  guest: boolean
  /** Whether a guest has been connected to a device; always true for accounts. */
  claimed: boolean
  role: MemberRole
  joinedAt: string
  rating: number
  matches: number
}

export type RoomSummary = {
  id: string
  name: string
  role: MemberRole
  memberCount: number
  /** Up to 5 members for avatar stacks. */
  members: UserRef[]
  liveMatches: number
  completedMatches: number
  myRating: number
  /** 1-based rating rank among members with at least one completed match, or null. */
  myRank: number | null
  lastActivityAt: string
}

export type RoomDetail = {
  id: string
  name: string
  role: MemberRole
  owner: UserRef
  createdAt: string
  /** Any member can share the invite link: `${origin}/join/${inviteCode}`. */
  inviteCode: string
  members: RoomMember[]
  liveMatches: MatchSummary[]
  /** Latest 10 completed matches. */
  recentMatches: MatchSummary[]
  /** Settings of the most recent match, for quick rematches. */
  defaults: MatchSettings
}

export type RoomsResponse = { rooms: RoomSummary[] }
export type RoomResponse = { room: RoomDetail }
/** POST /api/rooms, PATCH /api/rooms/:roomId */
export type RoomNameRequest = { name: string }
/** POST /api/rooms/:roomId/invite — regenerates the invite code (owner only). */
export type InviteCodeResponse = { inviteCode: string }
/** GET /api/rooms/:roomId/matches?before=<completedAt ISO>&limit=<1-50> — completed matches, newest first. */
export type MatchesResponse = { matches: MatchSummary[]; hasMore: boolean }

/** Server-sent event payload on GET /api/rooms/:roomId/events (event name `room`). */
export type RoomEvent =
  | { type: 'match'; match: MatchSummary }
  | { type: 'match-deleted'; matchId: string }
  | { type: 'refresh' }

// ── Invites ─────────────────────────────────────────────────────────────────

/** GET /api/invites/:code (sign-in optional) */
export type InvitePreview = {
  room: { id: string; name: string; memberCount: number; owner: UserRef }
  /** True when the signed-in viewer is already a member. */
  member: boolean
  /** Only unclaimed room guests can be connected to a new device. */
  guests: { id: string; name: string }[]
}
/** POST /api/invites/:code/guest — create or explicitly claim a guest and start a session. */
export type JoinGuestRequest = { name: string } | { guestId: string }
/** POST /api/rooms/:roomId/guests */
export type AddGuestResponse = { guest: RoomMember }
/** POST /api/invites/:code/join */
export type JoinResponse = { roomId: string }

// ── Leaderboards & statistics ───────────────────────────────────────────────

export type LeaderboardPeriod = 'all' | '30d' | '7d'

export type LeaderboardEntry = UserRef & {
  /** Elo-style room rating (starts at 1000, all-time regardless of period). */
  rating: number
  /** Rating change from the player's most recent match in the room. */
  ratingChange: number | null
  matches: number
  wins: number
  losses: number
  winRate: number | null
  legsWon: number
  legsPlayed: number
  average: number | null
  first9Average: number | null
  checkoutRate: number | null
  checkouts: number
  checkoutAttempts: number
  highestCheckout: number
  bestLegDarts: number | null
  scores180: number
  scores140: number
  scores100: number
  /** Most recent first, up to 5. */
  form: ('W' | 'L')[]
  lastPlayedAt: string | null
}

/** GET /api/rooms/:roomId/leaderboard?period=all|30d|7d — every current member, sorted by rating. */
export type LeaderboardResponse = { period: LeaderboardPeriod; entries: LeaderboardEntry[] }

/** GET /api/rooms/:roomId/players/:userId */
export type PlayerRoomStatsResponse = {
  player: RoomMember
  entry: LeaderboardEntry
  /** Oldest first, one point per ranked match. */
  ratingHistory: { at: string; rating: number }[]
  headToHead: { opponent: UserRef; wins: number; losses: number }[]
  recentMatches: MatchSummary[]
}

export type CareerTotals = Omit<LeaderboardEntry, keyof UserRef | 'rating' | 'ratingChange' | 'form'>

/** GET /api/me/stats — the signed-in user's statistics across all their rooms. */
export type CareerStatsResponse = {
  user: User
  totals: CareerTotals
  rooms: { id: string; name: string; rating: number; rank: number | null; matches: number }[]
  recentMatches: (MatchSummary & { roomName: string })[]
}
