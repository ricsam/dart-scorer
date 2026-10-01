import { findCheckout, findEasyCheckout } from '../src/game/checkout'
import type { GameState } from '../src/game/types'
import type { BotProfile } from '../src/shared/bots'

const board = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]
// Independent ring and angular accuracy; misses never invent a visit total.
const skills = [
  { treble: 0.025, double: 0.04, single: 0.28 },
  { treble: 0.075, double: 0.10, single: 0.48 },
  { treble: 0.15, double: 0.18, single: 0.67 },
  { treble: 0.26, double: 0.28, single: 0.81 },
  { treble: 0.40, double: 0.40, single: 0.90 },
  { treble: 0.58, double: 0.53, single: 0.96 },
] as const

// Only bounded, integer checkout states are cached, never whole games or players.
const routes = new Map<string, string | null>()
function checkout(score: number, doubleOut: boolean, darts: number, opening: boolean, easy: boolean) {
  if (!Number.isInteger(score) || score < 1 || score > 180) return null
  const key = `${score}/${doubleOut}/${darts}/${opening}/${easy}`
  if (!routes.has(key)) routes.set(key, (easy ? findEasyCheckout : findCheckout)(score, doubleOut, darts, opening)?.[0] ?? null)
  return routes.get(key) ?? null
}

function aim(state: GameState, bot: BotProfile): string {
  const player = state.players[state.active]
  if (!player || state.winner !== null || state.matchWinner !== null) return 'MISS'
  const score = player.score
  const opening = state.doubleIn && !player.opened
  const darts = 3 - state.currentVisit.length
  const finish = checkout(score, state.doubleOut, darts, opening, bot.difficulty <= 3)
  if (finish) return finish
  if (opening) return score > 40 ? 'D20' : `D${Math.max(1, Math.min(20, Math.floor((score - 2) / 2)))}`
  // Set up a comfortable double even on the final dart of a visit, rather than
  // deliberately busting an odd remainder or throwing at an unreachable out.
  if (state.doubleOut && score <= 60) {
    for (const leave of [32, 40, 16, 8, 4, 2]) {
      const single = score - leave
      if (single >= 1 && single <= 20) return String(single)
    }
  }
  if (!state.doubleOut && score <= 20) return String(score)
  // Avoid bogey numbers when a simple switch leaves a three-dart finish.
  const bogeys = [169, 168, 166, 165, 163, 162, 159]
  if (state.doubleOut && bogeys.includes(score - 60)) return 'T19'
  return score > 60 ? 'T20' : '20'
}

/** One physical dart. Does not mutate the game, advance turns or schedule work. */
export function botDart(state: GameState, bot: BotProfile, random: () => number = Math.random): string {
  const target = aim(state, bot)
  if (target === 'MISS') return target
  const skill = skills[bot.difficulty - 1]
  // Clamp custom RNG endpoints defensively; no rejection sampling or retry loops.
  const draw = () => { const value = random(); return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0.5 }
  const bull = target === 'BULL' || target === '25'
  const double = target.startsWith('D') || target === 'BULL'
  const treble = target.startsWith('T')
  const accuracy = bull ? skill.double * (target === 'BULL' ? 0.7 : 1.2) : double ? skill.double : treble ? skill.treble : skill.single
  if (draw() < accuracy) return target
  const miss = draw()
  if (bull) return miss < 0.65 ? (target === 'BULL' ? '25' : String(board[Math.floor(draw() * 20)])) : miss < 0.95 ? String(board[Math.floor(draw() * 20)]) : 'MISS'
  const number = Number(target.replace(/^[DT]/, ''))
  const index = board.indexOf(number)
  const neighbor = () => board[(index + (draw() < 0.5 ? 19 : 1)) % 20]
  if (double) {
    if (miss < 0.48) return 'MISS' // outside the double ring
    if (miss < 0.88) return String(number) // inside the wire
    return `${draw() < 0.35 ? 'D' : ''}${neighbor()}`
  }
  if (treble) {
    if (miss < skill.single) return String(number)
    if (miss < 0.96) return `${draw() < 0.12 ? 'T' : ''}${neighbor()}`
    return 'MISS'
  }
  if (miss < 0.76) return String(neighbor())
  if (miss < 0.88) return `T${number}`
  if (miss < 0.94) return `D${number}`
  return 'MISS'
}
