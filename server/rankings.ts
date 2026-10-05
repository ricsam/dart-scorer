import { Hono } from 'hono'
import type { RankingEntry, RankingsResponse } from '../src/shared/api'
import { requireUser } from './auth'
import type { AppEnv, Services } from './context'
import { displayRating } from './ratings'
import { toUserRef } from './users'

export const RANKINGS_LIMIT = 100

type RankingRow = { user_id: string; name: string; avatar_url: string | null; rating: number; matches: number; wins: number; points: number | null; darts: number | null; last_played_at: string | null }

/** Global rankings: every account with a saved ranked lobby match, by Elo. */
export function rankingRoutes(services: Services) {
  const { db } = services
  const app = new Hono<AppEnv>()

  app.get('/rankings', (c) => {
    const user = requireUser(c)
    const rows = db.all<RankingRow>(
      `SELECT g.user_id, u.name, u.avatar_url, g.rating, g.matches, g.wins,
         (SELECT SUM(r.points) FROM match_results r JOIN matches m ON m.id = r.match_id WHERE m.ranked = 1 AND r.user_id = g.user_id) AS points,
         (SELECT SUM(r.darts) FROM match_results r JOIN matches m ON m.id = r.match_id WHERE m.ranked = 1 AND r.user_id = g.user_id) AS darts,
         (SELECT MAX(r.completed_at) FROM match_results r JOIN matches m ON m.id = r.match_id WHERE m.ranked = 1 AND r.user_id = g.user_id) AS last_played_at
       FROM global_ratings g JOIN users u ON u.id = g.user_id
       ORDER BY ROUND(g.rating) DESC, g.matches DESC, u.name, g.user_id`,
    )
    // Players with the same rounded rating share a rank.
    let previous: number | null = null
    let rank = 0
    const entries = rows.map((row, index): RankingEntry => {
      const rating = displayRating(row.rating)
      if (rating !== previous) rank = index + 1
      previous = rating
      return {
        ...toUserRef({ id: row.user_id, name: row.name, avatar_url: row.avatar_url }),
        rank,
        rating,
        matches: row.matches,
        wins: row.wins,
        losses: row.matches - row.wins,
        average: row.darts ? ((row.points ?? 0) / row.darts) * 3 : null,
        lastPlayedAt: row.last_played_at,
      }
    })
    return c.json<RankingsResponse>({
      entries: entries.slice(0, RANKINGS_LIMIT),
      me: entries.find((entry) => entry.id === user.id) ?? null,
      totalPlayers: entries.length,
    })
  })

  return app
}
