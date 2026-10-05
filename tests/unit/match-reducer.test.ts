import { describe, expect, it } from 'vitest'
import { createGameState, gameReducer, type GameState } from '../../src/game'
import { reduceMatchAction, undoTargetSlot } from '../../src/shared/match-reducer'
import { forfeitPlacings } from '../../server/results'

const players = (bots: (string | null)[]) => bots.map((botId) => ({ botId }))
const game = (count: number) => createGameState({ game: 501, players: Array.from({ length: count }, (_, index) => ({ name: `P${index}` })) })
const submit = (state: GameState, entry: string) => gameReducer(state, { type: 'submit', entry })

describe('undo target', () => {
  it('names the slot whose dart or visit undo removes', () => {
    const humans = players([null, null])
    let state = game(2)
    expect(undoTargetSlot(state, humans)).toBeNull()
    state = submit(state, 'T20')
    expect(undoTargetSlot(state, humans)).toBe(0)
    state = submit(state, 'T20 T20')
    expect(state.active).toBe(1)
    expect(undoTargetSlot(state, humans)).toBe(0) // reopens player 0's visit
    state = submit(state, '20')
    expect(undoTargetSlot(state, humans)).toBe(1)
  })

  it('skips bot replies like the match reducer does', () => {
    const withBot = players([null, 'pub-pete'])
    let state = game(2)
    state = submit(state, '20 20 20')
    state = submit(state, 'T20')
    expect(state.active).toBe(1)
    expect(undoTargetSlot(state, withBot)).toBe(0)
    const undone = reduceMatchAction(state, { type: 'undo' }, withBot)
    expect(undone.active).toBe(0)
    expect(undone.currentVisit.map((dart) => dart.label)).toEqual(['20', '20'])
    expect(undoTargetSlot(game(2), withBot)).toBeNull()
  })
})

describe('forfeit placings', () => {
  it('puts the forfeiting slot last and ranks the rest by legs', () => {
    const state = game(3)
    state.players[0].legs = 1
    state.players[1].legs = 2
    state.players[2].legs = 2
    expect(forfeitPlacings(state, 1)).toEqual([2, 3, 1])
    expect(forfeitPlacings(state, 0)).toEqual([3, 1, 1])
  })
})
