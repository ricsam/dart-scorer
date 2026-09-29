import { describe, expect, it } from 'vitest'
import { createGameState, evaluateEntry, gameReducer, type GameAction, type GameState } from '../../src/game'

function newGame(overrides: Partial<Parameters<typeof createGameState>[0]> = {}) {
  return createGameState({ game: 101, doubleOut: true, players: [{ name: 'Alex' }, { name: 'Jamie' }], ...overrides })
}

function apply(state: GameState, ...actions: (GameAction | string)[]) {
  return actions.reduce<GameState>((current, action) => gameReducer(current, typeof action === 'string' ? { type: 'submit', entry: action } : action), state)
}

describe('dart entry', () => {
  it('parses shorthand, rings, bulls and misses', () => {
    const { hits, total, error } = evaluateEntry('t20 d16 25', 0)
    expect(error).toBeNull()
    expect(hits.map((hit) => hit.label)).toEqual(['T20', 'D16', '25'])
    expect(total).toBe(117)
    expect(evaluateEntry('', 0).hits.map((hit) => hit.label)).toEqual(['MISS'])
    expect(evaluateEntry('36', 0).hits[0]).toMatchObject({ value: 36, isDouble: false })
    expect(evaluateEntry('DB', 0).hits[0]).toMatchObject({ label: 'BULL', value: 50, isDouble: true })
  })

  it('rejects unknown darts and too many darts for the visit', () => {
    expect(evaluateEntry('T21', 0).error).toBe('“T21” is not a valid dart.')
    expect(evaluateEntry('20 20', 2).error).toBe('Only 1 dart left in this visit.')
    expect(evaluateEntry('20 20 20 20', 0).error).toBe('Only 3 darts left in this visit.')
  })
})

describe('game engine', () => {
  it('keeps partial visits open and rotates after three darts', () => {
    let state = apply(newGame(), '20')
    expect(state.players[0].score).toBe(81)
    expect(state.currentVisit).toHaveLength(1)
    expect(state.active).toBe(0)

    state = apply(state, '20 20')
    expect(state.players[0]).toMatchObject({ score: 41, darts: 3, turns: [60] })
    expect(state.history).toHaveLength(1)
    expect(state.active).toBe(1)
  })

  it('busts below zero, on one, and on a non-double finish', () => {
    const below = apply(newGame(), 'T20 T20 T20')
    expect(below.players[0]).toMatchObject({ score: 101, darts: 2, turns: [0] })
    expect(below.history[0]).toMatchObject({ bust: true, value: 0, dartCount: 2 })

    const onOne = apply(newGame(), 'T20 20 20')
    expect(onOne.history[0].bust).toBe(true)

    const nonDouble = apply(newGame(), 'T20 20 1', 'M M M', '20')
    expect(nonDouble.history.at(-1)).toMatchObject({ bust: true, player: 0, dartCount: 1 })
    expect(nonDouble.players[0].score).toBe(20)
    expect(apply(nonDouble, 'M M M', 'D10').winner).toBe(0)
  })

  it('allows single-out finishes on any dart', () => {
    const state = apply(newGame({ doubleOut: false }), '20 20 20', 'M M M', '41')
    expect(state.winner).toBe(0)
  })

  it('records a won leg, rotates the starter, and preserves legs across resets', () => {
    let state = apply(newGame(), '20 20 20', 'T20 T20 T20', '1 D20')
    expect(state.winner).toBe(0)
    expect(state.players[0].legs).toBe(1)
    expect(state.legHistory).toHaveLength(1)
    expect(state.legHistory[0]).toMatchObject({ leg: 1, winnerName: 'Alex', starterName: 'Alex', winningDarts: '1 · D20' })
    expect(state.legHistory[0].players.map((player) => player.average.toFixed(1))).toEqual(['60.6', '0.0'])

    // No scoring until the next leg starts.
    expect(apply(state, '20')).toBe(state)
    expect(gameReducer(state, { type: 'resetLeg' })).toBe(state)

    state = gameReducer(state, { type: 'nextLeg' })
    expect(state).toMatchObject({ winner: null, active: 1, legStarter: 1, history: [] })
    expect(state.players.map((player) => player.score)).toEqual([101, 101])

    state = apply(state, 'T20', { type: 'resetLeg' })
    expect(state.players.map((player) => [player.score, player.legs])).toEqual([[101, 1], [101, 0]])
    expect(state.active).toBe(1)
  })

  it('declares a match winner once the leg target is reached', () => {
    let state = newGame({ legsToWin: 2 })
    state = apply(state, '20 20 20', 'M M M', '1 D20')
    expect(state.matchWinner).toBeNull()
    state = apply(state, { type: 'nextLeg' }, '20 20 20', 'M M M', '1 D20')
    expect(state.winner).toBe(1)
    expect(state.matchWinner).toBeNull()
    state = apply(state, { type: 'nextLeg' }, '20 20 20', 'M M M', 'D20 1', 'T20', '1 D20')
    expect(state.players.map((player) => player.legs)).toEqual([1, 2])
    expect(state.matchWinner).toBe(1)
    expect(gameReducer(state, { type: 'nextLeg' })).toBe(state)

    const undone = gameReducer(state, { type: 'undo' })
    expect(undone.matchWinner).toBeNull()
    expect(undone.winner).toBeNull()
    expect(undone.players[1].legs).toBe(1)
    expect(undone.legHistory).toHaveLength(2)
  })

  it('undoes single darts, reopens completed visits, and reverts busts', () => {
    let state = apply(newGame(), 'T20')
    state = gameReducer(state, { type: 'undo' })
    expect(state.players[0]).toMatchObject({ score: 101, darts: 0 })
    expect(state.currentVisit).toEqual([])

    state = apply(state, '20 20 20', { type: 'undo' })
    expect(state.active).toBe(0)
    expect(state.players[0]).toMatchObject({ score: 61, darts: 2, turns: [] })
    expect(state.currentVisit.map((dart) => dart.label)).toEqual(['20', '20'])

    state = apply(state, 'D20', 'T20 T20 T20', { type: 'undo' })
    expect(state.active).toBe(1)
    expect(state.players[1]).toMatchObject({ score: 101, darts: 0, turns: [] })
    expect(state.history).toHaveLength(1)
  })

  it('requires a double to open scoring under double-in', () => {
    let state = apply(newGame({ doubleIn: true }), '20 D10 20')
    expect(state.players[0]).toMatchObject({ score: 61, opened: true })
    expect(state.history[0].darts.map((dart) => dart.counts)).toEqual([false, true, true])

    state = apply(newGame({ doubleIn: true }), '20 20 20')
    expect(state.players[0]).toMatchObject({ score: 101, opened: false, turns: [0] })

    state = apply(newGame({ doubleIn: true }), 'D10', { type: 'undo' })
    expect(state.players[0]).toMatchObject({ score: 101, opened: false })
  })

  it('rewinds to the start of a visit in a completed leg', () => {
    let state = apply(newGame(), '20 20 20', 'T20 T20 T20', '1 D20', { type: 'nextLeg' }, 'T20')
    const leg = state.legHistory[0]
    state = gameReducer(state, { type: 'rewind', legId: leg.id, visitIndex: 1 })
    expect(state.players.map((player) => [player.score, player.legs])).toEqual([[41, 0], [101, 0]])
    expect(state).toMatchObject({ active: 1, legStarter: 0, winner: null, legHistory: [] })
    expect(state.history).toHaveLength(1)
    expect(gameReducer(state, { type: 'rewind', legId: 'missing', visitIndex: 0 })).toBe(state)
  })

  it('manages the roster and format for casual games', () => {
    let state = apply(newGame(), { type: 'addPlayer' }, { type: 'renamePlayer', index: 2, name: 'Robin' }, { type: 'setGame', game: 301 })
    expect(state.players.map((player) => [player.name, player.score])).toEqual([['Alex', 301], ['Jamie', 301], ['Robin', 301]])
    state = apply(state, 'T20 T20 T20', '60 0 0', { type: 'removePlayer', index: 1 })
    expect(state.players.map((player) => player.name)).toEqual(['Alex', 'Robin'])
    expect(state.active).toBe(1)
    expect(state.history.map((visit) => visit.player)).toEqual([0])
    expect(gameReducer(state, { type: 'removePlayer', index: 0 })).toBe(state)
    expect(gameReducer(state, { type: 'setGame', game: 999 })).toBe(state)
  })

  it('toggles in and out rules without resetting the leg', () => {
    let state = apply(newGame(), 'T20', { type: 'setDoubleIn', value: true })
    expect(state.players.map((player) => player.opened)).toEqual([true, false])
    state = gameReducer(state, { type: 'setDoubleOut', value: false })
    expect(state.doubleOut).toBe(false)
    expect(state.players[0].score).toBe(41)
  })
})
