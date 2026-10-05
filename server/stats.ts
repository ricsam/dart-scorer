import { Hono } from 'hono'
import type {
  CareerTotals,
  TrainingMatchTotals,
  StatsHistoryPoint,
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardResponse,
  PlayerLeagueStatsResponse,
  UserRef,
} from '../src/shared/api'
import { requireUser } from './auth'
import type { AppEnv, Services } from './context'
import { memberRows, requireLeague, leagueMembers, summarize, type MatchRow, type ResultRow } from './data'
import type { Db } from './db'
import { badRequest, notFound } from './http'
import { displayRating, INITIAL_RATING, leagueRatings } from './ratings'
import { toUserRef } from './users'

const DAY_MS = 24 * 60 * 60 * 1000
const PERIODS: Record<LeaderboardPeriod, number | null> = { all: null, '30d': 30 * DAY_MS, '7d': 7 * DAY_MS }

export function parsePeriod(value: string | undefined): LeaderboardPeriod {
  if (value === undefined || value === '') return 'all'
  if (Object.hasOwn(PERIODS, value)) return value as LeaderboardPeriod
  throw badRequest('period must be one of all, 30d, 7d.')
}

/** Aggregates result rows (most recent first) into totals. */
export function aggregateResults(rows: ResultRow[]): CareerTotals {
  let wins = 0
  let legsWon = 0
  let legsPlayed = 0
  let darts = 0
  let points = 0
  let first9Points = 0
  let first9Darts = 0
  let checkouts = 0
  let checkoutAttempts = 0
  let highestCheckout = 0
  let bestLegDarts: number | null = null
  let scores180 = 0
  let scores140 = 0
  let scores100 = 0
  let lastPlayedAt: string | null = null
  for (const row of rows) {
    if (row.won) wins += 1
    legsWon += row.legs_won
    legsPlayed += row.legs_played
    darts += row.darts
    points += row.points
    first9Points += row.first9_points
    first9Darts += row.first9_darts
    checkouts += row.checkouts
    checkoutAttempts += row.checkout_attempts
    highestCheckout = Math.max(highestCheckout, row.highest_checkout)
    if (row.best_leg_darts !== null) bestLegDarts = bestLegDarts === null ? row.best_leg_darts : Math.min(bestLegDarts, row.best_leg_darts)
    scores180 += row.scores_180
    scores140 += row.scores_140
    scores100 += row.scores_100
    if (lastPlayedAt === null || row.completed_at > lastPlayedAt) lastPlayedAt = row.completed_at
  }
  const matches = rows.length
  return {
    matches,
    wins,
    losses: matches - wins,
    winRate: matches ? wins / matches : null,
    legsWon,
    legsPlayed,
    average: darts ? (points / darts) * 3 : null,
    first9Average: first9Darts ? (first9Points / first9Darts) * 3 : null,
    checkoutRate: checkoutAttempts ? checkouts / checkoutAttempts : null,
    checkouts,
    checkoutAttempts,
    highestCheckout,
    bestLegDarts,
    scores180,
    scores140,
    scores100,
    lastPlayedAt,
  }
}

/** Training intentionally has no match win/loss metrics. */
export function aggregateTrainingResults(rows: ResultRow[]): TrainingMatchTotals {
  const { wins, losses, winRate, ...totals } = aggregateResults(rows)
  void wins; void losses; void winRate
  return totals
}

export function resultsHistory(rows: ResultRow[]): StatsHistoryPoint[] {
  const months = new Map<string, ResultRow[]>()
  for (const row of rows) {
    const at = `${new Date(row.completed_at).toISOString().slice(0, 7)}-01T00:00:00.000Z`
    const bucket = months.get(at) ?? []
    bucket.push(row)
    months.set(at, bucket)
  }
  return [...months].sort(([a], [b]) => a.localeCompare(b)).map(([at, bucket]) => {
    const { average, matches } = aggregateTrainingResults(bucket)
    return { at, average, matches }
  })
}

/** Result rows for users in a league since `since` (inclusive), most recent first. */
function leagueResults(db: Db, leagueId: string, since: string | null, training = false) {
  return db.all<ResultRow>(
    `SELECT r.* FROM match_results r JOIN matches m ON m.id = r.match_id
     WHERE r.league_id = ? AND r.user_id IS NOT NULL AND (? IS NULL OR r.completed_at >= ?) AND m.practice = ?
     ORDER BY r.completed_at DESC, r.match_id DESC`,
    leagueId, since, since, training ? 1 : 0,
  )
}

function groupByUser(rows: ResultRow[]) {
  const byUser = new Map<string, ResultRow[]>()
  for (const row of rows) {
    if (row.user_id === null) continue
    const list = byUser.get(row.user_id)
    if (list) list.push(row)
    else byUser.set(row.user_id, [row])
  }
  return byUser
}

/** Leaderboard entries for `users`; `periodRows` filter the stats, `allRows` give the rating change. */
function buildEntries(db: Db, leagueId: string, users: UserRef[], periodRows: ResultRow[], allRows: ResultRow[]): LeaderboardEntry[] {
  const ratings = leagueRatings(db, leagueId)
  const inPeriod = groupByUser(periodRows)
  const allTime = groupByUser(allRows)
  return users.map((user) => {
    const rows = inPeriod.get(user.id) ?? []
    const latest = allTime.get(user.id)?.find((row) => row.rating_before !== null && row.rating_after !== null)
    return {
      ...user,
      rating: displayRating(ratings.get(user.id)?.rating ?? INITIAL_RATING),
      ratingChange: latest ? displayRating(latest.rating_after!) - displayRating(latest.rating_before!) : null,
      ...aggregateResults(rows),
      form: rows.slice(0, 5).map((row) => (row.won ? 'W' : 'L')),
    }
  })
}

export function sortEntries(entries: LeaderboardEntry[]) {
  return entries.sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export function statsRoutes(services: Services) {
  const { db } = services
  const app = new Hono<AppEnv>()

  app.get('/leagues/:leagueId/leaderboard', (c) => {
    const user = requireUser(c)
    const league = requireLeague(db, c.req.param('leagueId'), user.id)
    const period = parsePeriod(c.req.query('period'))
    const span = PERIODS[period]
    const since = span === null ? null : new Date(services.now().getTime() - span).toISOString()
    const allRows = leagueResults(db, league.id, null)
    const periodRows = since === null ? allRows : allRows.filter((row) => row.completed_at >= since)
    const members = memberRows(db, league.id).filter((member) => !member.is_guest).map(toUserRef)
    const entries = sortEntries(buildEntries(db, league.id, members, periodRows, allRows))
    return c.json<LeaderboardResponse>({ period, entries })
  })

  app.get('/leagues/:leagueId/players/:userId', (c) => {
    const user = requireUser(c)
    const league = requireLeague(db, c.req.param('leagueId'), user.id)
    const targetId = c.req.param('userId')
    const player = leagueMembers(db, league.id).find((member) => member.id === targetId)
    if (!player || player.guest) throw notFound('Player not found in this league.')

    const allRows = leagueResults(db, league.id, null)
    const ref: UserRef = { id: player.id, name: player.name, avatarUrl: player.avatarUrl }
    const [entry] = buildEntries(db, league.id, [ref], allRows, allRows)

    const ratingHistory = allRows
      .filter((row) => row.user_id === player.id && row.rating_after !== null)
      .reverse()
      .map((row) => ({ at: row.completed_at, rating: displayRating(row.rating_after!) }))

    const pairs = db.all<{ opponent_id: string; name: string; avatar_url: string | null; mine: number; theirs: number }>(
      `SELECT opp.user_id AS opponent_id, u.name, u.avatar_url, me.placing AS mine, opp.placing AS theirs
       FROM match_results me
       JOIN match_results opp ON opp.match_id = me.match_id AND opp.slot != me.slot
       JOIN users u ON u.id = opp.user_id
       WHERE me.league_id = ? AND me.user_id = ? AND opp.user_id IS NOT NULL AND opp.user_id != me.user_id
         AND NOT EXISTS (SELECT 1 FROM matches pm WHERE pm.id = me.match_id AND pm.practice = 1)`,
      league.id, player.id,
    )
    const headToHead = new Map<string, { opponent: UserRef; wins: number; losses: number }>()
    for (const pair of pairs) {
      const record = headToHead.get(pair.opponent_id) ?? { opponent: toUserRef({ id: pair.opponent_id, name: pair.name, avatar_url: pair.avatar_url }), wins: 0, losses: 0 }
      if (pair.mine < pair.theirs) record.wins += 1
      else if (pair.mine > pair.theirs) record.losses += 1
      headToHead.set(pair.opponent_id, record)
    }

    const recent = (training = false) => db.all<MatchRow>(
      `SELECT m.* FROM matches m
       WHERE m.league_id = ? AND m.status = 'completed' AND m.practice = ?
         AND EXISTS (SELECT 1 FROM match_players p WHERE p.match_id = m.id AND p.user_id = ?)
       ORDER BY m.completed_at DESC, m.id DESC LIMIT 10`,
      league.id, training ? 1 : 0, player.id,
    )

    const trainingRows = leagueResults(db, league.id, null, true).filter((row) => row.user_id === player.id)
    return c.json<PlayerLeagueStatsResponse>({
      player,
      entry,
      ratingHistory,
      headToHead: [...headToHead.values()].sort((a, b) =>
        (b.wins + b.losses) - (a.wins + a.losses) || a.opponent.name.localeCompare(b.opponent.name)),
      history: resultsHistory(allRows.filter((row) => row.user_id === player.id)),
      recentMatches: summarize(db, recent()),
      training: {
        totals: aggregateTrainingResults(trainingRows),
        history: resultsHistory(trainingRows),
        recentMatches: summarize(db, recent(true)),
      },
    })
  })

  return app
}
