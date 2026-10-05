import { describe, expect, it } from 'vitest'
import { evaluateTrainingEntry, MAX_TRAINING_ENTRY_LENGTH, reduceTraining, trainingDart, trainingResults, trainingTarget, type TrainingState } from '../../src/shared/training'
const players = [{ id: 'a', name: 'A', guest: false }, { id: 'b', name: 'B', guest: false }]
describe('training engine', () => {
  const empty: TrainingState = { active: 0, throws: [] }
  const solo = players.slice(0, 1)
  const clock = Array.from({ length: 20 }, (_, i) => `T${i + 1}`).join(' ')
  it('evaluates mixed separators, normalization and all nine darts in one action', () => {
    const entry = 's20,t20 + D20\nDB sb 0 60 1 2'
    expect(evaluateTrainingEntry('nine-dart', solo, empty, entry)).toMatchObject({ total: 258, dartsRemaining: 9, error: null })
    const state = reduceTraining('nine-dart', solo, empty, { type: 'submit', entry })
    expect(state.throws.map((t) => t.entry)).toEqual(['20', 'T20', 'D20', 'BULL', '25', 'MISS', '60', '1', '2'])
    expect(trainingResults('nine-dart', solo, state)[0]).toMatchObject({ darts: 9, points: 258, hits: 8, finished: true })
    expect(evaluateTrainingEntry('nine-dart', solo, state, 'MISS').error).toContain('Completed')
  })
  it('accepts a full clock or all 60 misses and rejects excess after early completion', () => {
    for (const entry of [clock, Array(60).fill('MISS').join(' ')]) {
      const state = reduceTraining('around-clock', solo, empty, { type: 'submit', entry })
      expect(trainingResults('around-clock', solo, state)[0].finished).toBe(true)
    }
    expect(evaluateTrainingEntry('around-clock', solo, empty, `${clock} MISS`).error).toContain('completes')
  })
  it('rejects blank, oversized, over-limit and invalid middle darts atomically', () => {
    for (const mode of ['nine-dart', 'around-clock'] as const) {
      for (const entry of ['', '  ', ', + ', ' '.repeat(MAX_TRAINING_ENTRY_LENGTH + 1), '1 2 180 3', '1 2 T25 3', Array(61).fill('MISS').join(' ')]) {
        expect(evaluateTrainingEntry(mode, solo, empty, entry).error).toBeTruthy()
        expect(() => reduceTraining(mode, solo, empty, { type: 'submit', entry })).toThrow()
        expect(empty).toEqual({ active: 0, throws: [] })
      }
    }
    expect(evaluateTrainingEntry('around-clock', solo, empty, '1 60 2').error).toContain('Use S')
    expect(evaluateTrainingEntry('nine-dart', solo, empty, Array(10).fill('1').join(' ')).error).toBeTruthy()
  })
  it('accepts the maximum 480-dart multiplayer clock batch', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: String(i), guest: false }))
    const entry = Array(480).fill('MISS').join(', ')
    expect(evaluateTrainingEntry('around-clock', eight, empty, entry)).toMatchObject({ dartsRemaining: 480, total: 0, error: null })
    const state = reduceTraining('around-clock', eight, empty, { type: 'submit', entry })
    expect(state.throws).toHaveLength(480)
    expect(trainingResults('around-clock', eight, state).every((r) => r.darts === 60 && r.finished)).toBe(true)
  })
  it('crosses multiplayer turns and undo removes only one dart from a batch', () => {
    const initial = reduceTraining('nine-dart', players, empty, { type: 'submit', entry: '1 2' })
    expect(evaluateTrainingEntry('nine-dart', players, initial, '3 4 5 6 7').dartsRemaining).toBe(16)
    const state = reduceTraining('nine-dart', players, initial, { type: 'submit', entry: '3 4 5 6 7' })
    expect(state.throws.map((t) => t.slot)).toEqual([0, 0, 0, 1, 1, 1, 0])
    const undone = reduceTraining('nine-dart', players, state, { type: 'undo' })
    expect(undone.throws).toEqual(state.throws.slice(0, -1))
    expect(undone.active).toBe(0)
  })
  it('skips a player finishing mid-turn within the same batch', () => {
    const entries: string[] = []
    for (let n = 1; n <= 18; n += 3) entries.push(`${n}`, `${n + 1}`, `${n + 2}`, 'MISS', 'MISS', 'MISS')
    entries.push('19', '20', '1', '2', '3', '4')
    const state = reduceTraining('around-clock', players, empty, { type: 'submit', entry: entries.join(' ') })
    expect(state.throws.slice(-6).map((t) => t.slot)).toEqual([0, 0, 1, 1, 1, 1])
    expect(trainingResults('around-clock', players, state).map((r) => r.hits)).toEqual([20, 4])
    expect(evaluateTrainingEntry('around-clock', players, state, '5').dartsRemaining).toBe(38)
    const final = reduceTraining('around-clock', players, state, { type: 'submit', entry: Array.from({ length: 16 }, (_, i) => String(i + 5)).join(' ') })
    expect(trainingResults('around-clock', players, final).every((r) => r.finished)).toBe(true)
  })
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
