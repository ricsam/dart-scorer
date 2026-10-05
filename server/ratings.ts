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

type ResultKey = { match_id: string; slot: number; user_id: string | null; placing: number; practice: number }

/** Replays result rows (ordered by completion) and rewrites each row's rating_before/rating_after. */
function replayRatings(db: Db, rows: ResultKey[]) {
  const ratings = new Map<string, number>()
  const current = (userId: string) => ratings.get(userId) ?? INITIAL_RATING
  db.transaction(() => {
    for (let start = 0; start < rows.length;) {
      let end = start
      while (end < rows.length && rows[end].match_id === rows[start].match_id) end += 1
      const group = rows.slice(start, end)
      if (rows[start].practice) {
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

/**
 * Replays a league's completed matches in order (completed_at, id) and rewrites every
 * result's rating_before/rating_after. Practice (bot) matches never carry a rating.
 * Call inside the transaction that changed the results.
 */
export function recomputeLeagueRatings(db: Db, leagueId: string) {
  return replayRatings(db, db.all<ResultKey>(
    `SELECT r.match_id, r.slot, r.user_id, r.placing, m.practice FROM match_results r JOIN matches m ON m.id = r.match_id
     WHERE r.league_id = ? ORDER BY r.completed_at, r.match_id, r.slot`,
    leagueId,
  ))
}

/**
 * Replays every ranked lobby match into the global rating (same Elo as leagues) and rebuilds
 * the `global_ratings` table used by rankings. Call inside the transaction that changed results.
 */
export function recomputeGlobalRatings(db: Db, now: string) {
  return db.transaction(() => {
    const ratings = replayRatings(db, db.all<ResultKey>(
      `SELECT r.match_id, r.slot, r.user_id, r.placing, 0 AS practice FROM match_results r JOIN matches m ON m.id = r.match_id
       WHERE m.ranked = 1 ORDER BY r.completed_at, r.match_id, r.slot`,
    ))
    const counts = new Map(db.all<{ user_id: string; matches: number; wins: number }>(
      `SELECT r.user_id, COUNT(*) AS matches, SUM(r.won) AS wins FROM match_results r JOIN matches m ON m.id = r.match_id
       WHERE m.ranked = 1 AND r.user_id IS NOT NULL GROUP BY r.user_id`,
    ).map((row) => [row.user_id, row]))
    db.run('DELETE FROM global_ratings')
    for (const [userId, rating] of ratings) {
      const count = counts.get(userId)
      db.run('INSERT INTO global_ratings (user_id, rating, matches, wins, updated_at) VALUES (?, ?, ?, ?, ?)', userId, rating, count?.matches ?? 0, count?.wins ?? 0, now)
    }
    return ratings
  })
}

export type GlobalRatingRow = { user_id: string; rating: number; matches: number; wins: number }

/**
 * Applies one newly saved ranked match on top of the current global ratings (results are saved
 * one at a time, so this equals a replay in save order). Call inside the saving transaction.
 */
export function applyGlobalRatings(db: Db, matchId: string, now: string) {
  const rows = db.all<{ slot: number; user_id: string; placing: number; won: number }>(
    'SELECT slot, user_id, placing, won FROM match_results WHERE match_id = ? AND user_id IS NOT NULL ORDER BY slot', matchId,
  )
  if (rows.length < 2) return
  const current = globalRatingsFor(db, rows.map((row) => row.user_id))
  const before = rows.map((row) => current.get(row.user_id)?.rating ?? INITIAL_RATING)
  const deltas = eloDeltas(before, rows.map((row) => row.placing))
  rows.forEach((row, index) => {
    const after = before[index] + deltas[index]
    db.run('UPDATE match_results SET rating_before = ?, rating_after = ? WHERE match_id = ? AND slot = ?', before[index], after, matchId, row.slot)
    db.run(
      `INSERT INTO global_ratings (user_id, rating, matches, wins, updated_at) VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET rating = excluded.rating, matches = matches + 1, wins = wins + excluded.wins, updated_at = excluded.updated_at`,
      row.user_id, after, row.won, now,
    )
  })
}

/** Current global rating rows for the given users (missing users have no ranked result yet). */
export function globalRatingsFor(db: Db, userIds: string[]) {
  const map = new Map<string, GlobalRatingRow>()
  for (const userId of new Set(userIds)) {
    const row = db.get<GlobalRatingRow>('SELECT user_id, rating, matches, wins FROM global_ratings WHERE user_id = ?', userId)
    if (row) map.set(userId, row)
  }
  return map
}

/** 1-based global rank by rounded rating, or null before the first ranked result. */
export function globalRank(db: Db, userId: string) {
  const mine = db.get<{ rating: number }>('SELECT rating FROM global_ratings WHERE user_id = ?', userId)
  if (!mine) return null
  const above = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM global_ratings WHERE ROUND(rating) > ROUND(?)', mine.rating)?.count ?? 0
  return above + 1
}

/** Current (full precision) rating and rated-match count for every user with ranked results in a league. */
export function leagueRatings(db: Db, leagueId: string) {
  const rows = db.all<{ user_id: string; rating_after: number | null }>(
    'SELECT user_id, rating_after FROM match_results WHERE league_id = ? AND user_id IS NOT NULL AND rating_after IS NOT NULL ORDER BY completed_at, match_id',
    leagueId,
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
