import { Hono } from 'hono'
import type { CareerStatsResponse, MeResponse, UpdateMeResponse } from '../src/shared/api'
import { requireUser } from './auth'
import type { AppEnv, Services } from './context'
import { buildMatchView, matchSummary, memberRows, type MatchRow, type ResultRow, type RoomRow } from './data'
import { expectObject, expectText, readJson, forbidden } from './http'
import { displayRating, INITIAL_RATING, rankIn, roomRatings } from './ratings'
import { aggregateResults } from './stats'
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
    // Totals cover every result the user ever recorded (their own numbers), including rooms they left.
    const results = db.all<ResultRow>('SELECT * FROM match_results WHERE user_id = ? ORDER BY completed_at DESC, match_id DESC', user.id)

    const rooms = db.all<RoomRow>(
      'SELECT r.* FROM room_members m JOIN rooms r ON r.id = m.room_id WHERE m.user_id = ? ORDER BY m.joined_at, r.id',
      user.id,
    ).map((room) => {
      const ratings = roomRatings(db, room.id)
      const mine = ratings.get(user.id)
      return {
        id: room.id,
        name: room.name,
        rating: displayRating(mine?.rating ?? INITIAL_RATING),
        rank: rankIn(ratings, memberRows(db, room.id).filter((member) => !member.is_guest).map((member) => member.id), user.id),
        matches: mine?.matches ?? 0,
      }
    })

    // Match details are only shown for rooms the user can still see.
    const recent = db.all<MatchRow & { room_name: string }>(
      `SELECT m.*, r.name AS room_name FROM matches m
       JOIN rooms r ON r.id = m.room_id
       JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = ?
       WHERE m.status = 'completed'
         AND EXISTS (SELECT 1 FROM match_players p WHERE p.match_id = m.id AND p.user_id = ?)
       ORDER BY m.completed_at DESC, m.id DESC LIMIT 10`,
      user.id, user.id,
    )

    return c.json<CareerStatsResponse>({
      user: toUser(user),
      totals: aggregateResults(results),
      rooms,
      recentMatches: recent.map(({ room_name: roomName, ...row }) => ({ ...matchSummary(buildMatchView(db, row)), roomName })),
    })
  })

  return app
}
