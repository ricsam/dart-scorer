import type { Db } from './db'

export const INITIAL_RATING = 1000
export const RATING_K = 32

/**
 * Multi-player Elo: every pair of ranked players is a mini-game (win/draw/loss by placing),
 * scaled by K/(n−1) so a two-player match is classic Elo. All deltas use the pre-match ratings.
 */
export function eloDeltas(ratings: number[], placings: number[], k = RATING_K): number[] {
  const n = ratings.length
  if (n < 2) return ratings.map(() => 0)
  return ratings.map((rating, i) => {
    let sum = 0
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue
      const score = placings[i] < placings[j] ? 1 : placings[i] === placings[j] ? 0.5 : 0
      const expected = 1 / (1 + 10 ** ((ratings[j] - rating) / 400))
      sum += score - expected
    }
    return (k / (n - 1)) * sum
  })
}

/** Ratings are stored with full precision and rounded for display. */
export function displayRating(value: number) {
  return Math.round(value)
}

type ResultKey = { match_id: string; slot: number; user_id: string | null; placing: number }

/**
 * Replays a room's completed matches in order (completed_at, id) and rewrites every
 * result's rating_before/rating_after. Call inside the transaction that changed the results.
 */
export function recomputeRoomRatings(db: Db, roomId: string) {
  const rows = db.all<ResultKey>(
    'SELECT match_id, slot, user_id, placing FROM match_results WHERE room_id = ? ORDER BY completed_at, match_id, slot',
    roomId,
  )
  const botMatches = new Set(db.all<{ match_id: string }>(
    'SELECT DISTINCT p.match_id FROM match_players p JOIN matches m ON m.id = p.match_id WHERE m.room_id = ? AND p.bot_id IS NOT NULL', roomId,
  ).map((row) => row.match_id))
  const ratings = new Map<string, number>()
  const current = (userId: string) => ratings.get(userId) ?? INITIAL_RATING

  db.transaction(() => {
    for (let start = 0; start < rows.length;) {
      let end = start
      while (end < rows.length && rows[end].match_id === rows[start].match_id) end += 1
      const group = rows.slice(start, end)
      if (botMatches.has(rows[start].match_id)) {
        db.run('UPDATE match_results SET rating_before = NULL, rating_after = NULL WHERE match_id = ?', rows[start].match_id)
        start = end
        continue
      }
      const ranked = group.filter((row): row is ResultKey & { user_id: string } => row.user_id !== null)
      const before = ranked.map((row) => current(row.user_id))
      const deltas = ranked.length >= 2 ? eloDeltas(before, ranked.map((row) => row.placing)) : ranked.map(() => 0)

      ranked.forEach((row, index) => {
        const after = before[index] + deltas[index]
        ratings.set(row.user_id, after)
        db.run('UPDATE match_results SET rating_before = ?, rating_after = ? WHERE match_id = ? AND slot = ?', before[index], after, row.match_id, row.slot)
      })
      for (const row of group) {
        if (row.user_id === null) db.run('UPDATE match_results SET rating_before = NULL, rating_after = NULL WHERE match_id = ? AND slot = ?', row.match_id, row.slot)
      }
      start = end
    }
  })
  return ratings
}

/** Current (full precision) rating and rated-match count for every user with ranked results in a room. */
export function roomRatings(db: Db, roomId: string) {
  const rows = db.all<{ user_id: string; rating_after: number | null }>(
    'SELECT user_id, rating_after FROM match_results WHERE room_id = ? AND user_id IS NOT NULL AND rating_after IS NOT NULL ORDER BY completed_at, match_id',
    roomId,
  )
  const ratings = new Map<string, { rating: number; matches: number }>()
  for (const row of rows) {
    const entry = ratings.get(row.user_id) ?? { rating: INITIAL_RATING, matches: 0 }
    entry.matches += 1
    if (row.rating_after !== null) entry.rating = row.rating_after
    ratings.set(row.user_id, entry)
  }
  return ratings
}

/** 1-based rank of `userId` by rating among `memberIds` that have played; null if the user hasn't. */
export function rankIn(ratings: Map<string, { rating: number; matches: number }>, memberIds: Iterable<string>, userId: string) {
  const mine = ratings.get(userId)
  if (!mine || mine.matches === 0) return null
  let rank = 1
  for (const memberId of memberIds) {
    if (memberId === userId) continue
    const other = ratings.get(memberId)
    if (other && other.matches > 0 && displayRating(other.rating) > displayRating(mine.rating)) rank += 1
  }
  return rank
}
