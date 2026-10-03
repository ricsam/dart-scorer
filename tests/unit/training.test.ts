import { describe, expect, it } from 'vitest'
import { reduceTraining, trainingDart, trainingResults, trainingTarget, type TrainingState } from '../../src/shared/training'
const players = [{ id: 'a', name: 'A', guest: false }, { id: 'b', name: 'B', guest: false }]
describe('training engine', () => {
  it('counts every miss, rotates in threes, preserves zero and completes nine darts each', () => {
    let state: TrainingState = { active: 0, throws: [] }
    for (let n = 0; n < 18; n++) state = reduceTraining('nine-dart', players, state, { type: 'submit', entry: 'MISS' })
    expect(state.throws.map((t) => t.slot)).toEqual([0,0,0,1,1,1,0,0,0,1,1,1,0,0,0,1,1,1])
    expect(trainingResults('nine-dart', players, state).map((r) => [r.darts, r.score, r.finished])).toEqual([[9,0,true],[9,0,true]])
    expect(() => reduceTraining('nine-dart', players, state, { type: 'undo' })).toThrow('Completed')
  })
  it('advances clock once per matching ring, skips finishers and replays undo', () => {
    let state: TrainingState = { active: 0, throws: [] }
    while (!trainingResults('around-clock', players, state)[0].finished) {
      const r = trainingResults('around-clock', players, state)[0]
      state = reduceTraining('around-clock', players, state, { type: 'submit', entry: state.active === 0 ? `T${r.hits + 1}` : 'BULL' })
    }
    expect(state.active).toBe(1)
    expect(trainingResults('around-clock', players, state)[0]).toMatchObject({ hits: 20, darts: 20, finished: true, score: 20 })
    state = reduceTraining('around-clock', players, state, { type: 'undo' })
    expect(state.active).toBe(0)
    expect(trainingResults('around-clock', players, state)[0].hits).toBe(19)
  })
  it('limits clock to 60 darts and exposes active target', () => {
    let state: TrainingState = { active: 0, throws: [] }
    for (let n = 0; n < 60; n++) state = reduceTraining('around-clock', players.slice(0,1), state, { type: 'submit', entry: 'MISS' })
    expect(trainingResults('around-clock', players.slice(0,1), state)[0]).toMatchObject({ darts: 60, hits: 0, finished: true })
    expect(trainingTarget({ mode: 'around-clock', state, results: [], status: 'live' })).toBe('1')
  })
  it('rejects multiple/invalid/ambiguous darts and accepts explicit rings and bulls', () => {
    for (const entry of ['', '1 2', '180', 'T25', '-1', 'NaN']) expect(() => trainingDart('nine-dart', entry)).toThrow()
    expect(() => trainingDart('around-clock', '60')).toThrow()
    for (const entry of ['T20', 'D20', 'S20', 'DB', '25', '0']) expect(trainingDart('around-clock', entry)).toBeTruthy()
    expect(trainingDart('nine-dart', '60').value).toBe(60)
  })
})
