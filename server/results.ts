import { computePlayerStats, matchPlacings, type GameState } from '../src/game'
import { addChatMessage } from './chat'
import { nowIso, type Services } from './context'
import { loadMatchView, type MatchView } from './data'
import { publishMatch } from './events'
import { badRequest } from './http'
import { applyGlobalRatings, recomputeLeagueRatings } from './ratings'

/** Placings when `forfeitSlot` concedes: they finish last, everyone else by legs won (ties share). */
export function forfeitPlacings(state: GameState, forfeitSlot: number): number[] {
  return state.players.map((player, index) => {
    if (index === forfeitSlot) return state.players.length
    return 1 + state.players.filter((other, otherIndex) => otherIndex !== index && otherIndex !== forfeitSlot && other.legs > player.legs).length
  })
}

export type SaveReason = 'confirmed' | 'auto' | 'conceded' | 'claimed'

/**
 * Saves a live match's result: per-slot statistics from completed legs, placings, league or
 * global ratings. A forfeit ends the match immediately with the forfeiting slot last.
 * Synchronous from validation to commit, so concurrent requests cannot both save.
 */
export function saveMatchResult(services: Services, view: MatchView, options: { forfeitSlot?: number; reason?: SaveReason } = {}) {
  const { db } = services
  const { state, row } = view
  const forfeitSlot = options.forfeitSlot ?? null
  if (row.status !== 'live') throw badRequest('This match is already finished.')
  if (forfeitSlot === null && state.matchWinner === null) throw badRequest('The match has no winner yet.')
  if (forfeitSlot !== null && state.matchWinner !== null) throw badRequest('The match is already decided. Save the result instead.')

  const stats = computePlayerStats(state, { includeCurrentLeg: false })
  const placings = forfeitSlot === null ? matchPlacings(state) : forfeitPlacings(state, forfeitSlot)
  const winners = forfeitSlot === null
    ? new Set([state.matchWinner!])
    : new Set(placings.filter((placing) => placing === 1).length === 1 ? [placings.indexOf(1)] : [])
  const now = nowIso(services)
  db.transaction(() => {
    for (const player of view.players) {
      const s = stats[player.slot]
      db.run(
        `INSERT INTO match_results (
           match_id, slot, league_id, user_id, placing, won,
           legs_won, legs_played, darts, points, visits, first9_points, first9_darts,
           scores_180, scores_140, scores_100, checkout_attempts, checkouts, highest_checkout, best_leg_darts,
           rating_before, rating_after, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
        row.id, player.slot, row.league_id, player.userId, placings[player.slot], winners.has(player.slot) ? 1 : 0,
        s.legsWon, s.legsPlayed, s.darts, s.points, s.visits, s.first9Points, s.first9Darts,
        s.scores180, s.scores140, s.scores100, s.checkoutAttempts, s.checkouts, s.highestCheckout, s.bestLegDarts,
        now,
      )
    }
    const updated = db.run(
      "UPDATE matches SET status = 'completed', forfeit_slot = ?, version = version + 1, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'live'",
      forfeitSlot, now, now, row.id,
    )
    if (updated.changes !== 1) throw badRequest('This match is already finished.')
    if (row.league_id) recomputeLeagueRatings(db, row.league_id)
    if (row.ranked) applyGlobalRatings(db, row.id, now)
  })

  publishMatch(services, row.id)
  if (row.lobby_id) announceResult(services, view, winners, forfeitSlot, options.reason ?? 'confirmed')
  return loadMatchView(db, row.id)!
}

function announceResult(services: Services, view: MatchView, winners: Set<number>, forfeitSlot: number | null, reason: SaveReason) {
  const lobbyId = view.row.lobby_id
  if (!lobbyId || !services.db.get('SELECT 1 FROM lobbies WHERE id = ?', lobbyId)) return
  const legs = view.state.players.map((player) => player.legs).join('–')
  const name = (slot: number) => view.players[slot]?.name ?? 'Player'
  const winner = [...winners][0]
  const forfeiter = forfeitSlot === null ? null : view.players[forfeitSlot]
  const actor = (reason === 'conceded' ? forfeiter?.userId : null)
    ?? (winner !== undefined ? view.players[winner]?.userId : null)
    ?? view.row.created_by
  const body = forfeitSlot !== null
    ? `${name(forfeitSlot)} ${reason === 'claimed' ? 'timed out' : 'conceded'}${winner !== undefined ? ` · ${name(winner)} wins` : ''} (legs ${legs}).`
    : view.players.length === 1
      ? `${name(0)} finished a ${view.settings.game} practice game.`
      : `${name(winner!)} won ${legs}${reason === 'auto' ? ' · saved automatically' : ''}.`
  addChatMessage(services, { lobbyId }, actor, body, 'system')
}
