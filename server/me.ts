import { Hono } from 'hono'
import type { CareerStatsResponse, GlobalRating, MeResponse, UpdateMeResponse } from '../src/shared/api'
import { requireUser } from './auth'
import type { AppEnv, Services } from './context'
import { buildMatchView, matchSummary, memberRows, type MatchRow, type ResultRow, type LeagueRow } from './data'
import type { Db } from './db'
import { expectObject, expectText, readJson, forbidden } from './http'
import { displayRating, globalRank, INITIAL_RATING, rankIn, leagueRatings } from './ratings'
import { aggregateResults, aggregateTrainingResults, resultsHistory, resultsTrend } from './stats'
import { toUser, USER_NAME_MAX_LENGTH } from './users'

/** The user's global rating, rank and rating after each ranked match. */
export function globalRatingFor(db: Db, userId: string): GlobalRating {
  const row = db.get<{ rating: number; matches: number; wins: number }>('SELECT rating, matches, wins FROM global_ratings WHERE user_id = ?', userId)
  const history = db.all<{ completed_at: string; rating_after: number }>(
    `SELECT r.completed_at, r.rating_after FROM match_results r JOIN matches m ON m.id = r.match_id
     WHERE m.ranked = 1 AND r.user_id = ? AND r.rating_after IS NOT NULL ORDER BY r.completed_at, r.match_id`,
    userId,
  )
  return {
    rating: displayRating(row?.rating ?? INITIAL_RATING),
    rank: globalRank(db, userId),
    matches: row?.matches ?? 0,
    wins: row?.wins ?? 0,
    losses: (row?.matches ?? 0) - (row?.wins ?? 0),
    history: history.map((point) => ({ at: point.completed_at, rating: displayRating(point.rating_after) })),
  }
}

export function meRoutes(services: Services) {
  const { db, config } = services
  const app = new Hono<AppEnv>()

  app.get('/me', (c) => {
    const user = c.get('user')
    return c.json<MeResponse>({
      user: user ? toUser(user) : null,
      auth: { google: config.google !== null && services.google !== null, dev: config.devLogin },
    })
  })

  app.patch('/me', async (c) => {
    if (requireUser(c).is_guest) throw forbidden('Guests cannot update profiles.')
    const body = expectObject(await readJson(c))
    const name = expectText(body.name, 'Name', 1, USER_NAME_MAX_LENGTH)
    const user = requireUser(c)
    db.run('UPDATE users SET name = ? WHERE id = ?', name, user.id)
    return c.json<UpdateMeResponse>({ user: toUser({ ...user, name }) })
  })

  app.get('/me/stats', (c) => {
    const user = requireUser(c)
    if (user.is_guest) throw forbidden('Guests do not have career statistics.')
    // Totals cover every result the user ever recorded (their own numbers), including leagues they left.
    const allRows = db.all<ResultRow & { practice: number; ranked: number }>(
      `SELECT r.*, m.practice, m.ranked FROM match_results r JOIN matches m ON m.id = r.match_id
       WHERE r.user_id = ? ORDER BY r.completed_at DESC, r.match_id DESC`, user.id,
    )
    const results = allRows.filter((row) => !row.practice)
    const trainingRows = allRows.filter((row) => row.practice)

    const leagues = db.all<LeagueRow>(
      'SELECT r.* FROM league_members m JOIN leagues r ON r.id = m.league_id WHERE m.user_id = ? ORDER BY m.joined_at, r.id',
      user.id,
    ).map((league) => {
      const ratings = leagueRatings(db, league.id)
      const mine = ratings.get(user.id)
      return {
        id: league.id,
        name: league.name,
        rating: displayRating(mine?.rating ?? INITIAL_RATING),
        rank: rankIn(ratings, memberRows(db, league.id).filter((member) => !member.is_guest).map((member) => member.id), user.id),
        matches: mine?.matches ?? 0,
      }
    })

    // Match details are only shown for leagues the user can still see; lobby games are always theirs.
    const recent = (training: boolean) => db.all<MatchRow & { league_name: string | null }>(
      `SELECT m.*, r.name AS league_name FROM matches m
       LEFT JOIN leagues r ON r.id = m.league_id
       WHERE m.status = 'completed' AND m.practice = ?
         AND EXISTS (SELECT 1 FROM match_players p WHERE p.match_id = m.id AND p.user_id = ?)
         AND (m.league_id IS NULL OR EXISTS (SELECT 1 FROM league_members rm WHERE rm.league_id = m.league_id AND rm.user_id = ?))
       ORDER BY m.completed_at DESC, m.id DESC LIMIT 10`,
      training ? 1 : 0, user.id, user.id,
    ).map(({ league_name: leagueName, ...row }) => ({ ...matchSummary(buildMatchView(db, row)), leagueName }))

    return c.json<CareerStatsResponse>({
      user: toUser(user),
      totals: aggregateResults(results),
      leagues,
      history: resultsHistory(results),
      recentMatches: recent(false),
      training: {
        totals: aggregateTrainingResults(trainingRows),
        history: resultsHistory(trainingRows),
        trend: resultsTrend(trainingRows),
        recentMatches: recent(true),
      },
      all: { totals: aggregateTrainingResults(allRows), history: resultsHistory(allRows) },
      trend: resultsTrend(allRows),
      competitionTrend: resultsTrend(results),
      global: globalRatingFor(db, user.id),
    })
  })

  return app
}
