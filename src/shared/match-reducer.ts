import { gameReducer } from '../game/engine'
import type { GameAction, GameState } from '../game/types'
import type { MatchPlayer } from './api'

type Players = Pick<MatchPlayer, 'botId'>[]

/** Undo a human entry and discard the bot replies to it, rather than immediately replaying an undone bot dart. */
export function reduceMatchAction(state: GameState, action: GameAction, players: Players): GameState {
  if (action.type !== 'undo' || !players.some((player) => player.botId)) return gameReducer(state, action)
  const isBot = (slot: number) => Boolean(players[slot]?.botId)
  if (state.currentVisit.length && !isBot(state.active)) return gameReducer(state, action)
  if (!state.history.some((visit) => !isBot(visit.player))) return state

  let next = state
  while ((next.currentVisit.length && isBot(next.active))
    || (!next.currentVisit.length && next.history.length && isBot(next.history[next.history.length - 1].player))) {
    next = gameReducer(next, action)
  }
  return gameReducer(next, action)
}

/**
 * The human slot whose dart or visit `undo` would remove (after discarding bot replies),
 * or null when undo is a no-op. Mirrors `reduceMatchAction`.
 */
export function undoTargetSlot(state: GameState, players: Players): number | null {
  const isBot = (slot: number) => Boolean(players[slot]?.botId)
  const target = (current: GameState) => current.currentVisit.length
    ? current.active
    : current.history[current.history.length - 1]?.player ?? null
  if (!players.some((player) => player.botId)) return target(state)
  if (state.currentVisit.length && !isBot(state.active)) return state.active
  if (!state.history.some((visit) => !isBot(visit.player))) return null
  let next = state
  while ((next.currentVisit.length && isBot(next.active))
    || (!next.currentVisit.length && next.history.length && isBot(next.history[next.history.length - 1].player))) {
    next = gameReducer(next, { type: 'undo' })
  }
  return target(next)
}
