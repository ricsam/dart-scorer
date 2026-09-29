import { isOneDartFinish } from './checkout'
import type { GameState, Visit } from './types'

export type PlayerStats = {
  legsWon: number
  legsPlayed: number
  darts: number
  points: number
  visits: number
  /** Points per three darts, counting every dart thrown (busts score zero). */
  average: number
  first9Points: number
  first9Darts: number
  /** Three-dart average over each leg's first nine darts (short legs use actual darts). */
  first9Average: number
  scores180: number
  /** Visits of 140–179. */
  scores140: number
  /** Visits of 100–139. */
  scores100: number
  /** Darts thrown while a single dart could finish the leg. */
  checkoutAttempts: number
  checkouts: number
  checkoutRate: number | null
  highestCheckout: number
  /** Fewest darts used to win a leg. */
  bestLegDarts: number | null
}

export function emptyPlayerStats(): PlayerStats {
  return {
    legsWon: 0,
    legsPlayed: 0,
    darts: 0,
    points: 0,
    visits: 0,
    average: 0,
    first9Points: 0,
    first9Darts: 0,
    first9Average: 0,
    scores180: 0,
    scores140: 0,
    scores100: 0,
    checkoutAttempts: 0,
    checkouts: 0,
    checkoutRate: null,
    highestCheckout: 0,
    bestLegDarts: null,
  }
}

/** Darts in a visit thrown while one dart could have won the leg. */
export function countCheckoutAttempts(visit: Visit): number {
  let remaining = visit.previousScore
  let opened = visit.previouslyOpened
  let attempts = 0
  for (const dart of visit.darts) {
    if (opened && isOneDartFinish(remaining, visit.doubleOut)) attempts += 1
    if (dart.openedGame) opened = true
    if (dart.counts) remaining -= dart.value
  }
  return attempts
}

function recordLeg(stats: PlayerStats[], visits: Visit[], completed: boolean) {
  const dartsInLeg = new Map<number, number>()
  for (const visit of visits) {
    const playerStats = stats[visit.player]
    if (!playerStats) continue
    const earlierDarts = dartsInLeg.get(visit.player) ?? 0
    dartsInLeg.set(visit.player, earlierDarts + visit.dartCount)

    playerStats.darts += visit.dartCount
    playerStats.points += visit.value
    playerStats.visits += 1
    const firstDarts = Math.min(visit.dartCount, Math.max(0, 9 - earlierDarts))
    playerStats.first9Darts += firstDarts
    if (!visit.bust) playerStats.first9Points += visit.darts.slice(0, firstDarts).reduce((sum, dart) => sum + (dart.counts ? dart.value : 0), 0)
    if (visit.value === 180) playerStats.scores180 += 1
    else if (visit.value >= 140) playerStats.scores140 += 1
    else if (visit.value >= 100) playerStats.scores100 += 1
    playerStats.checkoutAttempts += countCheckoutAttempts(visit)

    if (visit.won && completed) {
      playerStats.checkouts += 1
      playerStats.legsWon += 1
      playerStats.highestCheckout = Math.max(playerStats.highestCheckout, visit.previousScore)
      const legDarts = dartsInLeg.get(visit.player) ?? 0
      playerStats.bestLegDarts = playerStats.bestLegDarts === null ? legDarts : Math.min(playerStats.bestLegDarts, legDarts)
    }
  }
}

export function finalizePlayerStats(stats: PlayerStats): PlayerStats {
  return {
    ...stats,
    average: stats.darts ? stats.points / stats.darts * 3 : 0,
    first9Average: stats.first9Darts ? stats.first9Points / stats.first9Darts * 3 : 0,
    checkoutRate: stats.checkoutAttempts ? stats.checkouts / stats.checkoutAttempts : null,
  }
}

/**
 * Aggregates statistics for every player from completed legs and, optionally,
 * the leg in progress. Player indexes match `state.players`.
 */
export function computePlayerStats(state: GameState, options: { includeCurrentLeg?: boolean } = {}): PlayerStats[] {
  const includeCurrentLeg = options.includeCurrentLeg ?? true
  const stats = state.players.map(() => emptyPlayerStats())

  for (const leg of state.legHistory) {
    leg.playersAtStart.forEach((_, index) => {
      if (stats[index]) stats[index].legsPlayed += 1
    })
    recordLeg(stats, leg.visits, true)
  }

  // Once a leg is won its visits already live in legHistory; only count an unfinished leg once.
  if (includeCurrentLeg && state.winner === null) {
    const visits = [...state.history]
    if (state.currentVisit.length) {
      const value = state.currentVisit.reduce((sum, dart) => sum + (dart.counts ? dart.value : 0), 0)
      visits.push({ player: state.active, value, previousScore: state.players[state.active].score + value,
        previouslyOpened: !state.currentVisit.some((dart) => dart.openedGame) && state.players[state.active].opened,
        bust: false, won: false, darts: state.currentVisit, dartCount: state.currentVisit.length,
        doubleIn: state.doubleIn, doubleOut: state.doubleOut })
    }
    recordLeg(stats, visits, false)
  }

  return stats.map(finalizePlayerStats)
}

/** Final placing for each player: the match winner first, then by legs won. Equal legs share a place. */
export function matchPlacings(state: GameState): number[] {
  const legs = state.players.map((player) => player.legs)
  return state.players.map((_, index) => {
    if (state.matchWinner === index) return 1
    const better = state.players.filter((__, other) => other !== index && (other === state.matchWinner || legs[other] > legs[index])).length
    return better + 1
  })
}
