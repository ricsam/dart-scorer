import { Hono } from 'hono'
import type { CareerStatsResponse, MeResponse, UpdateMeResponse } from '../src/shared/api'
import { requireUser } from './auth'
import type { AppEnv, Services } from './context'
import { buildMatchView, matchSummary, memberRows, type MatchRow, type ResultRow, type LeagueRow } from './data'
import { expectObject, expectText, readJson, forbidden } from './http'
import { displayRating, INITIAL_RATING, rankIn, leagueRatings } from './ratings'
import { aggregateResults, aggregateTrainingResults, resultsHistory } from './stats'
import { toUser, USER_NAME_MAX_LENGTH } from './users'

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
    const resultRows = (training: boolean) => db.all<ResultRow>(
      `SELECT * FROM match_results WHERE user_id = ?
       AND ${training ? '' : 'NOT'} EXISTS (SELECT 1 FROM match_players bp WHERE bp.match_id = match_results.match_id AND bp.bot_id IS NOT NULL)
       ORDER BY completed_at DESC, match_id DESC`, user.id,
    )
    const results = resultRows(false)
    const trainingRows = resultRows(true)

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

    // Match details are only shown for leagues the user can still see.
    const recent = (training: boolean) => db.all<MatchRow & { league_name: string }>(
      `SELECT m.*, r.name AS league_name FROM matches m
       JOIN leagues r ON r.id = m.league_id
       JOIN league_members rm ON rm.league_id = m.league_id AND rm.user_id = ?
       WHERE m.status = 'completed'
         AND EXISTS (SELECT 1 FROM match_players p WHERE p.match_id = m.id AND p.user_id = ?)
         AND ${training ? '' : 'NOT'} EXISTS (SELECT 1 FROM match_players bp WHERE bp.match_id = m.id AND bp.bot_id IS NOT NULL)
       ORDER BY m.completed_at DESC, m.id DESC LIMIT 10`,
      user.id, user.id,
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
        recentMatches: recent(true),
      },
    })
  })

  return app
}
