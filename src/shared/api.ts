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
  /** `null` for guests, local players and bots, who are not ranked. */
  userId: string | null
  /** League guest identity; null for registered players, lobby local players and unlinked legacy guests. */
  guestId: string | null
  /** House bot identity; null for human players. Bots cannot sign in or claim guest slots. */
  botId: string | null
  name: string
  avatarUrl: string | null
  /** A human without an account in this match: a league guest or a lobby local player. */
  guest: boolean
}

export type MatchPlayerSummary = MatchPlayer & {
  legs: number
  score: number
  /** 3-dart average across the whole match so far. */
  average: number
  won: boolean
}

/**
 * Where a match was played. League matches feed that league's leaderboard; lobby matches
 * (including solo practice) have no league and, when `ranked`, update the global rating.
 */
export type MatchContext = {
  leagueId: string | null
  lobbyId: string | null
  /** Counts toward the global rating (ranked lobby matches only). */
  ranked: boolean
  /** Solo or bot games: tracked as training, never wins, losses or ratings. */
  practice: boolean
  /** Set when the match ended because this slot conceded or was claimed for inactivity. */
  forfeitSlot: number | null
}

export type MatchSummary = MatchContext & {
  id: string
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
  /** 1 = match winner; others by legs won, ties share a placing. A forfeited slot is last. */
  placing: number
  won: boolean
  stats: PlayerStats
  /** League rating (league matches) or global rating (ranked lobby matches) before/after; account players only. */
  ratingBefore: number | null
  ratingAfter: number | null
}

export type MatchDetail = MatchContext & {
  id: string
  leagueName: string | null
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
  /** Viewer may enter darts for at least one slot, start legs and save the result. */
  canScore: boolean
  /**
   * Slots the viewer enters darts for. League matches: every human slot for players, the creator
   * and the league hosts. Lobby matches: your own slot, plus local players for the lobby leader.
   * Undo is limited to the latest human dart in one of these slots.
   */
  controlledSlots: number[]
  /** Restart leg and visit rewind: league scorers, or lobby players who control every human slot. */
  canResetLeg: boolean
  /** Viewer may delete: live matches by creator or league hosts; completed matches by league hosts. Ranked lobby matches cannot be abandoned. */
  canDelete: boolean
  /** Lobby matches with two or more account players: the viewer may concede. */
  canConcede: boolean
  /** The active opponent can be claimed for inactivity from `at` (lobby matches with 2+ accounts). */
  claim: { slot: number; at: string } | null
  /** Lobby matches awaiting confirmation are saved automatically at this time. */
  autoSaveAt: string | null
  /** Account players currently connected to Oche. */
  onlineUserIds: string[]
  /** Viewer may read and post in this match's chat. */
  canChat: boolean
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

/**
 * POST /api/matches/:matchId/forfeit — concede your own slot, or claim the active opponent's slot
 * once `claim.at` has passed. Saves the result immediately: the forfeited slot places last.
 */
export type ForfeitMatchRequest = { baseVersion: number; slot: number }

/** Server-sent event payloads on GET /api/matches/:matchId/events: `match`, `chat` and `lobby` (lobby matches). */
export type MatchEvent = { match: MatchDetail }

/** GET /api/me/matches?status=live — the viewer's own unfinished matches, newest first. */
export type MyMatchesResponse = { matches: (MatchSummary & { leagueName: string | null })[] }

// ── Leagues ───────────────────────────────────────────────────────────────────

/** The original host remains the owner; co-hosts help manage the league. */
export type MemberRole = 'owner' | 'cohost' | 'member'

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
/** PATCH /api/leagues/:leagueId/members/:userId — hosts promote account members; only the owner can demote co-hosts. */
export type UpdateMemberRoleRequest = { role: 'cohost' | 'member' }
/** POST /api/leagues/:leagueId/invite — regenerates the invite code (owner or co-host). */
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

/** Scoring progress, with raw counts for correctly weighted rolling averages and checkout rates. */
export type ProgressStats = Pick<TrainingMatchTotals,
  'average' | 'first9Average' | 'checkoutRate' | 'checkouts' | 'checkoutAttempts' |
  'highestCheckout' | 'bestLegDarts' | 'scores180' | 'scores140' | 'scores100'
> & { points: number; darts: number; first9Points: number; first9Darts: number }

/** UTC calendar month (first day at midnight), oldest first. Rates use summed counts, not mean percentages. */
export type StatsHistoryPoint = ProgressStats & { at: string; matches: number }

/** One completed game in the per-game progress chart (oldest first). */
export type TrendPoint = ProgressStats & { matchId: string; at: string; practice: boolean; ranked: boolean }

export type GlobalRating = {
  /** Global Elo from ranked lobby matches (starts at 1000). */
  rating: number
  /** 1-based position among players with a ranked result, or null before the first one. */
  rank: number | null
  matches: number
  wins: number
  losses: number
  /** Oldest first, one point per ranked match. */
  history: { at: string; rating: number }[]
}

/** GET /api/me/stats — the signed-in user's statistics across leagues, lobbies and practice. */
export type CareerStatsResponse = {
  user: User
  /** Competition: saved matches against at least one other human, without bots. */
  totals: CareerTotals
  history: StatsHistoryPoint[]
  /** Training: solo and bot games. No wins, losses or ratings. */
  training: { totals: TrainingMatchTotals; history: StatsHistoryPoint[]; trend: TrendPoint[]; recentMatches: (MatchSummary & { leagueName: string | null })[] }
  /** Every saved game, competition and training combined. */
  all: { totals: TrainingMatchTotals; history: StatsHistoryPoint[] }
  /** Latest 50 saved games in each category, oldest first. */
  trend: TrendPoint[]
  competitionTrend: TrendPoint[]
  global: GlobalRating
  leagues: { id: string; name: string; rating: number; rank: number | null; matches: number }[]
  recentMatches: (MatchSummary & { leagueName: string | null })[]
}

// ── Global rankings ───────────────────────────────────────────────────────────────────────────

export type RankingEntry = UserRef & {
  rank: number
  rating: number
  /** Ranked matches played. Fewer than 5 is shown as provisional. */
  matches: number
  wins: number
  losses: number
  /** 3-dart average across ranked matches. */
  average: number | null
  lastPlayedAt: string | null
}

/** GET /api/rankings — top 100 by global rating, plus the viewer's own entry. */
export type RankingsResponse = { entries: RankingEntry[]; me: RankingEntry | null; totalPlayers: number }

// ── Lobbies ─────────────────────────────────────────────────────────────────────────────────

/** Public lobbies are listed for everyone; private lobbies need the invite link or a direct invite. */
export type LobbyVisibility = 'public' | 'private'

export type LobbySeat = {
  id: string
  /** Account player, house bot, or a local player scored on the leader's device. */
  kind: 'user' | 'bot' | 'local'
  userId: string | null
  botId: string | null
  name: string
  avatarUrl: string | null
  leader: boolean
  /** Bots and local players are always available; accounts are online with Oche open. */
  online: boolean
  /** Global rating for account players. */
  rating: number | null
  rankedMatches: number
}

export type LobbyDetail = {
  id: string
  leader: UserRef
  visibility: LobbyVisibility
  ranked: boolean
  /** Maximum seats, including bots and local players (1–8). */
  capacity: number
  settings: MatchSettings
  /** Throw order for the next game. The first seat rotates to the end after each start. */
  seats: LobbySeat[]
  /** The viewer's relation. Visitors see a preview and may join when `canJoin`. */
  role: 'leader' | 'member' | 'visitor'
  canJoin: boolean
  /** Why a visitor cannot join (full, private…), when `canJoin` is false. */
  joinBlockedReason: string | null
  /** Members only: `${origin}/lobbies/${id}?code=${inviteCode}`. */
  inviteCode: string | null
  /** Leader only: pending direct invites. */
  invited: UserRef[]
  /** The game in progress, if any. */
  match: MatchSummary | null
  lastMatch: MatchSummary | null
  createdAt: string
  updatedAt: string
}

export type LobbySummary = {
  id: string
  leader: UserRef & { rating: number | null }
  visibility: LobbyVisibility
  ranked: boolean
  capacity: number
  settings: MatchSettings
  seats: { name: string; avatarUrl: string | null; userId: string | null; botId: string | null }[]
  playing: boolean
  createdAt: string
  updatedAt: string
}

/** POST /api/lobbies body (all optional) and PATCH /api/lobbies/:id body (leader only). */
export type LobbyOptionsRequest = Partial<{ visibility: LobbyVisibility; ranked: boolean; capacity: number; settings: MatchSettings }>
export type LobbyResponse = { lobby: LobbyDetail }
/** GET /api/lobbies/current — the lobby the viewer sits in (one at a time). */
export type CurrentLobbyResponse = { lobby: LobbyDetail | null }
/** GET /api/lobbies — joinable public lobbies whose leader is online. */
export type LobbiesResponse = { lobbies: LobbySummary[] }
/** POST /api/lobbies/:id/join — `code` is required for private lobbies without a direct invite. Leaves any other lobby. */
export type JoinLobbyRequest = { code?: string }
/** POST /api/lobbies/:id/seats (leader) — add a bot (unranked lobbies) or a local player on the leader's device. */
export type AddSeatRequest = { botId: string } | { localName: string }
/** POST /api/lobbies/:id/order (leader) — a permutation of every seat id. */
export type ReorderSeatsRequest = { seatIds: string[] }
/** POST /api/lobbies/:id/start (leader) */
export type StartLobbyResponse = { matchId: string }

/** Server-sent events on GET /api/lobbies/:id/events (event `lobby`) and forwarded to its matches. */
export type LobbyEvent =
  | { type: 'lobby'; lobby: LobbyDetail }
  | { type: 'started'; matchId: string }
  /** You were removed by the leader, or the lobby closed. */
  | { type: 'removed' }
  | { type: 'closed' }

export type LobbyInvite = { lobby: LobbySummary; invitedBy: UserRef; createdAt: string }
/** GET /api/me/invites — pending invites to private lobbies; DELETE /api/me/invites/:lobbyId declines. */
export type InvitesResponse = { invites: LobbyInvite[] }
/** People you know: league members and recent lobby opponents. */
export type InviteCandidate = UserRef & { online: boolean; invited: boolean; member: boolean; via: string }
export type InviteCandidatesResponse = { candidates: InviteCandidate[] }

/** Server-sent events on GET /api/me/events (event `user`). */
export type UserEvent =
  | { type: 'invite'; invite: LobbyInvite }
  | { type: 'invite-removed'; lobbyId: string }

// ── Chat ───────────────────────────────────────────────────────────────────────────────────

export const CHAT_MAX_LENGTH = 280

/** `system` messages are complete sentences about lobby events; `user` is who caused them. */
export type ChatMessage = { id: string; user: UserRef; kind: 'text' | 'system'; body: string; createdAt: string }
/**
 * GET/POST /api/lobbies/:id/chat and /api/matches/:id/chat. A lobby match shares its lobby's
 * chat while the lobby exists. Responses list the latest 100 messages, oldest first.
 */
export type ChatResponse = { messages: ChatMessage[] }
export type ChatPostResponse = { message: ChatMessage }
/** Server-sent `chat` event on lobby and match streams. */
export type ChatEvent = { message: ChatMessage }
