import { describe, expect, it } from 'vitest'
import { computePlayerStats, countCheckoutAttempts, createGameState, gameReducer, isOneDartFinish, matchPlacings, type GameAction, type GameState } from '../../src/game'

function play(state: GameState, ...actions: (GameAction | string)[]) {
  return actions.reduce<GameState>((current, action) => gameReducer(current, typeof action === 'string' ? { type: 'submit', entry: action } : action), state)
}

const twoPlayers = [{ name: 'Alex' }, { name: 'Jamie' }]

describe('player statistics', () => {
  it('identifies one-dart finishes for both out rules', () => {
    expect([2, 32, 40, 50].every((score) => isOneDartFinish(score, true))).toBe(true)
    expect([1, 3, 41, 60].some((score) => isOneDartFinish(score, true))).toBe(false)
    expect([1, 20, 25, 39, 60].every((score) => isOneDartFinish(score, false))).toBe(true)
    expect(isOneDartFinish(59, false)).toBe(false)
  })

  it('aggregates averages, tons, checkouts and best legs across completed and live legs', () => {
    let state = createGameState({ game: 501, legsToWin: 2, players: twoPlayers })
    state = play(state,
      'T20 T20 T20', // Alex 180 → 321
      'T20 T20 20', // Jamie 140 → 361
      'T20 T20 T20', // Alex 180 → 141
      'T20 T20 20', // Jamie 140 → 221
      'T20 T19 D12', // Alex checks out 141 in nine darts
    )
    expect(state.winner).toBe(0)
    state = play(state, { type: 'nextLeg' },
      'T20 T20 T20', // Jamie 180 → 321
      'M M M', // Alex 0
      'T20 T20 T20', // Jamie 180 → 141
      '26 26 26', // Alex 78 → 423
      'T20 T20', // Partial visit counts in live statistics
    )

    const [alex, jamie] = computePlayerStats(state)
    expect(alex).toMatchObject({
      legsWon: 1, legsPlayed: 1, darts: 15, points: 579, visits: 5,
      first9Points: 579, first9Darts: 15, scores180: 2, scores140: 1, scores100: 0,
      checkoutAttempts: 1, checkouts: 1, checkoutRate: 1, highestCheckout: 141, bestLegDarts: 9,
    })
    expect(alex.average).toBeCloseTo(115.8)
    expect(jamie).toMatchObject({
      legsWon: 0, legsPlayed: 1, darts: 14, points: 760, visits: 5,
      scores180: 2, scores140: 2, checkoutAttempts: 0, checkoutRate: null, highestCheckout: 0, bestLegDarts: null,
    })
    expect(jamie.average).toBeCloseTo(760 / 14 * 3)

    const [alexCompleted, jamieCompleted] = computePlayerStats(state, { includeCurrentLeg: false })
    expect([alexCompleted.darts, alexCompleted.points, jamieCompleted.darts, jamieCompleted.points]).toEqual([9, 501, 6, 280])
  })

  it('counts every dart thrown at a finish', () => {
    let state = createGameState({ game: 101, players: twoPlayers })
    state = play(state, 'T20 1', 'M', 'M M M', 'M D20')
    expect(state.winner).toBe(0)
    expect(state.legHistory[0].visits.map(countCheckoutAttempts)).toEqual([1, 0, 2])

    const [alex, jamie] = computePlayerStats(state)
    expect(alex).toMatchObject({ checkoutAttempts: 3, checkouts: 1, first9Darts: 5, darts: 5, points: 101, highestCheckout: 40 })
    expect(alex.checkoutRate).toBeCloseTo(1 / 3)
    expect(jamie).toMatchObject({ checkoutAttempts: 0, checkoutRate: null, darts: 3, points: 0 })
  })

  it('does not double-count a won leg that is still on screen', () => {
    let state = createGameState({ game: 101, players: twoPlayers })
    state = play(state, '20 20 20', 'M M M', '1 D20')
    const [alex] = computePlayerStats(state)
    expect(alex.darts).toBe(5)
    expect(alex.points).toBe(101)
  })

  it('first nine follows actual darts rather than visits after early busts', () => {
    let state = createGameState({ game: 101, players: twoPlayers })
    // Four two-dart busts, then a finish on darts 9 and 10.
    for (let i = 0; i < 4; i++) state = play(state, 'T20 T20', 'M M M')
    state = play(state, 'T19 D22') // invalid; unchanged
    state = play(state, 'T19 D20') // 97 → 4, still in visit
    const stats = computePlayerStats(state)[0]
    expect(stats.darts).toBe(10)
    expect(stats.first9Darts).toBe(9)
    expect(stats.first9Points).toBe(57)
  })

  it('places the match winner first and ranks the rest by legs', () => {
    let state = createGameState({ game: 101, legsToWin: 1, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] })
    state = play(state, '20 20 20', 'M M M', 'M M M', '1 D20')
    expect(state.matchWinner).toBe(0)
    expect(matchPlacings(state)).toEqual([1, 2, 2])
  })
})
