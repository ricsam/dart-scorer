import { evaluateOnlineEntry } from '../game/entry'

export const TRAINING_MODES = [
  { id: 'around-clock', name: 'Around the clock', description: 'Hit 1–20 in order, in any ring. Finish within 60 darts.' },
  { id: 'nine-dart', name: 'Nine-dart challenge', description: 'Score as many points as possible with nine darts.' },
] as const
export type TrainingMode = (typeof TRAINING_MODES)[number]['id']
export type TrainingPlayer = { id: string; name: string; guest: boolean }
export type TrainingState = { active: number; throws: { slot: number; entry: string }[] }
export type TrainingPlayerResult = { playerId: string; name: string; darts: number; points: number; hits: number; finished: boolean; score: number }
export type TrainingSession = {
  id: string; roomId: string | null; roomName: string | null; mode: TrainingMode; status: 'live' | 'completed'
  players: TrainingPlayer[]; state: TrainingState; version: number; createdAt: string; completedAt: string | null
  canScore: boolean; canDelete: boolean; results: TrainingPlayerResult[]
}
export type TrainingResponse = { session: TrainingSession }
export type TrainingListResponse = { sessions: TrainingSession[] }
export type CreateTrainingRequest = { mode: TrainingMode; roomId?: string; playerIds?: string[] }
export type TrainingAction = { type: 'submit'; entry: string } | { type: 'undo' }

/** Explicit rings disambiguate clock targets; numeric totals above 20 are accepted only in points mode. */
export function trainingDart(mode: TrainingMode, entry: string) {
  if (typeof entry !== 'string' || !entry.trim() || entry.length > 16) throw new Error('Enter one physical dart.')
  const parsed = evaluateOnlineEntry(entry, 0)
  if (parsed.error || parsed.hits.length !== 1) throw new Error(parsed.error || 'Enter one physical dart.')
  const dart = parsed.hits[0]
  if (mode === 'around-clock' && /^\d+$/.test(dart.label) && dart.value > 20 && dart.value !== 25) throw new Error('Use S, D or T with a target number, or BULL.')
  return dart
}

export function trainingResults(mode: TrainingMode, players: TrainingPlayer[], state: TrainingState): TrainingPlayerResult[] {
  const results = players.map((p) => ({ playerId: p.id, name: p.name, darts: 0, points: 0, hits: 0, finished: false, score: 0 }))
  for (const item of state.throws) {
    const r = results[item.slot]
    const dart = trainingDart(mode, item.entry)
    r.darts++
    r.points += dart.value
    if (mode === 'around-clock' && Number(dart.label.replace(/^[SDT]/, '')) === r.hits + 1) r.hits++
    else if (mode === 'nine-dart' && dart.value > 0) r.hits++
    r.score = mode === 'around-clock' ? r.hits : r.points
    r.finished = mode === 'around-clock' ? r.hits === 20 || r.darts === 60 : r.darts === 9
  }
  return results
}

/** Replaying at most 480 darts makes undo deterministic without an unbounded snapshot history. */
function replay(mode: TrainingMode, players: TrainingPlayer[], entries: string[]): TrainingState {
  const state: TrainingState = { active: 0, throws: [] }
  let inTurn = 0
  for (const entry of entries) {
    state.throws.push({ slot: state.active, entry })
    inTurn++
    const results = trainingResults(mode, players, state)
    if (results.every((r) => r.finished)) break
    if (inTurn === 3 || results[state.active].finished) {
      do { state.active = (state.active + 1) % players.length } while (results[state.active].finished)
      inTurn = 0
    }
  }
  return state
}

export function reduceTraining(mode: TrainingMode, players: TrainingPlayer[], state: TrainingState, action: TrainingAction): TrainingState {
  if (players.length < 1 || players.length > 8) throw new Error('Training needs 1–8 players.')
  if (trainingResults(mode, players, state).every((r) => r.finished)) throw new Error('Completed training cannot be edited.')
  const entries = state.throws.map((item) => item.entry)
  if (action.type === 'undo') {
    if (!entries.length) throw new Error('No darts to undo.')
    entries.pop()
  } else {
    if (entries.length >= 480) throw new Error('Training is full.')
    entries.push(trainingDart(mode, action.entry).label)
  }
  return replay(mode, players, entries)
}

export function trainingTarget(session: Pick<TrainingSession, 'mode' | 'state' | 'results' | 'status'>): string {
  if (session.status === 'completed') return 'Completed'
  return session.mode === 'around-clock' ? String((session.results[session.state.active]?.hits ?? 0) + 1) : 'Highest score'
}
