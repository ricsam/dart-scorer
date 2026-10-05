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
  /** A league-scoped player without an account; never ranked. */
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
  /** League guest identity; null for registered players and unlinked legacy guests. */
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
  leagueId: string
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
  /** League rating before/after this match (ranked user players only). */
  ratingBefore: number | null
  ratingAfter: number | null
}

export type MatchDetail = {
  id: string
  leagueId: string
  leagueName: string
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
  /** Viewer may enter darts / undo / finish (match players, the creator and the league owner). */
  canScore: boolean
  /** Viewer may delete: live matches by creator or league owner; completed matches by the league owner. */
  canDelete: boolean
  /** Present once completed. */
  results: MatchResult[] | null
}

export type MatchResponse = { match: MatchDetail }

/** POST /api/leagues/:leagueId/matches */
export type CreateMatchRequest = {
  /** 2–8 players in throwing order, including at least one human. Named guests create/reuse a league guest. Matches with bots are unranked. */
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

// ── Leagues ───────────────────────────────────────────────────────────────────

export type MemberRole = 'owner' | 'member'

export type LeagueMember = UserRef & {
  guest: boolean
  /** Whether a guest has been connected to a device; always true for accounts. */
  claimed: boolean
  role: MemberRole
  joinedAt: string
  rating: number
  matches: number
}

export type LeagueSummary = {
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

export type LeagueDetail = {
  id: string
  name: string
  role: MemberRole
  owner: UserRef
  createdAt: string
  /** Any member can share the invite link: `${origin}/join/${inviteCode}`. */
  inviteCode: string
  members: LeagueMember[]
  liveMatches: MatchSummary[]
  /** Latest 10 completed matches. */
  recentMatches: MatchSummary[]
  /** Settings of the most recent match, for quick rematches. */
  defaults: MatchSettings
}

export type LeaguesResponse = { leagues: LeagueSummary[] }
export type LeagueResponse = { league: LeagueDetail }
/** POST /api/leagues, PATCH /api/leagues/:leagueId */
export type LeagueNameRequest = { name: string }
/** POST /api/leagues/:leagueId/invite — regenerates the invite code (owner only). */
export type InviteCodeResponse = { inviteCode: string }
/** GET /api/leagues/:leagueId/matches?before=<completedAt ISO>&limit=<1-50> — completed matches, newest first. */
export type MatchesResponse = { matches: MatchSummary[]; hasMore: boolean }

/** Server-sent event payload on GET /api/leagues/:leagueId/events (event name `league`). */
export type LeagueEvent =
  | { type: 'match'; match: MatchSummary }
  | { type: 'match-deleted'; matchId: string }
  | { type: 'refresh' }

// ── Invites ─────────────────────────────────────────────────────────────────

/** GET /api/invites/:code (sign-in optional) */
export type InvitePreview = {
  league: { id: string; name: string; memberCount: number; owner: UserRef }
  /** True when the signed-in viewer is already a member. */
  member: boolean
  /** Only unclaimed league guests can be connected to a new device. */
  guests: { id: string; name: string }[]
}
/** POST /api/invites/:code/guest — create or explicitly claim a guest and start a session. */
export type JoinGuestRequest = { name: string } | { guestId: string }
/** POST /api/leagues/:leagueId/guests */
export type AddGuestResponse = { guest: LeagueMember }
/** POST /api/invites/:code/join */
export type JoinResponse = { leagueId: string }

// ── Leaderboards & statistics ───────────────────────────────────────────────

export type LeaderboardPeriod = 'all' | '30d' | '7d'

export type LeaderboardEntry = UserRef & {
  /** Elo-style league rating (starts at 1000, all-time regardless of period). */
  rating: number
  /** Rating change from the player's most recent match in the league. */
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

/** GET /api/leagues/:leagueId/leaderboard?period=all|30d|7d — every current member, sorted by rating. */
export type LeaderboardResponse = { period: LeaderboardPeriod; entries: LeaderboardEntry[] }

/** GET /api/leagues/:leagueId/players/:userId */
export type PlayerLeagueStatsResponse = {
  player: LeagueMember
  entry: LeaderboardEntry
  history: StatsHistoryPoint[]
  training: { totals: TrainingMatchTotals; history: StatsHistoryPoint[]; recentMatches: MatchSummary[] }
  /** Oldest first, one point per ranked match. */
  ratingHistory: { at: string; rating: number }[]
  headToHead: { opponent: UserRef; wins: number; losses: number }[]
  recentMatches: MatchSummary[]
}

export type CareerTotals = Omit<LeaderboardEntry, keyof UserRef | 'rating' | 'ratingChange' | 'form'>

export type TrainingMatchTotals = Omit<CareerTotals, 'wins' | 'losses' | 'winRate'>

/** UTC calendar month (first day at midnight), oldest first; dart-weighted average. */
export type StatsHistoryPoint = { at: string; average: number | null; matches: number }

/** GET /api/me/stats — the signed-in user's statistics across all their leagues. */
export type CareerStatsResponse = {
  user: User
  totals: CareerTotals
  history: StatsHistoryPoint[]
  training: { totals: TrainingMatchTotals; history: StatsHistoryPoint[]; recentMatches: (MatchSummary & { leagueName: string })[] }
  leagues: { id: string; name: string; rating: number; rank: number | null; matches: number }[]
  recentMatches: (MatchSummary & { leagueName: string })[]
}
