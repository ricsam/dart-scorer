import { evaluateEntry } from './entry'
import type { DartHit, GameAction, GameState, LegResult, Player, Visit } from './types'

export const GAMES = [101, 301, 501, 701]
export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 8
export const PLAYER_NAME_MAX_LENGTH = 18

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createPlayer(name: string, score: number, opened = true, id = createId('player')): Player {
  return {
    id,
    name,
    score,
    legs: 0,
    darts: 0,
    turns: [],
    opened,
  }
}

export function clonePlayer(player: Player): Player {
  return { ...player, turns: [...player.turns] }
}

export function cloneVisit(visit: Visit): Visit {
  return { ...visit, darts: visit.darts.map((dart) => ({ ...dart })) }
}

export function visitScore(darts: DartHit[]) {
  return darts.reduce((sum, hit) => sum + (hit.counts ? hit.value : 0), 0)
}

export function restorePlayersBeforeVisit(leg: LegResult, visitIndex: number): Player[] {
  const earlierVisits = leg.visits.slice(0, visitIndex)

  return leg.playersAtStart.map((savedPlayer, playerIndex) => {
    const player = clonePlayer(savedPlayer)

    for (const visit of earlierVisits) {
      if (visit.player !== playerIndex) continue
      player.score = visit.bust ? visit.previousScore : visit.previousScore - visit.value
      player.darts += visit.dartCount
      player.turns = [...player.turns, visit.value]
      player.opened = visit.bust
        ? visit.previouslyOpened
        : visit.previouslyOpened || visit.darts.some((dart) => dart.openedGame)
      if (visit.won) player.legs += 1
    }

    return player
  })
}

export type GameSetup = {
  game?: number
  doubleIn?: boolean
  doubleOut?: boolean
  legsToWin?: number | null
  players: { id?: string; name: string }[]
}

export function createGameState(setup: GameSetup): GameState {
  const game = setup.game ?? 101
  const doubleIn = setup.doubleIn ?? false
  return {
    game,
    doubleIn,
    doubleOut: setup.doubleOut ?? true,
    legsToWin: setup.legsToWin ?? null,
    players: setup.players.map((player) => createPlayer(player.name, game, !doubleIn, player.id)),
    active: 0,
    legStarter: 0,
    currentVisit: [],
    history: [],
    legHistory: [],
    winner: null,
    matchWinner: null,
  }
}

function resetLegState(state: GameState, game: number, starter: number, requiresDoubleIn: boolean): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player, score: game, darts: 0, turns: [], opened: !requiresDoubleIn })),
    active: starter,
    currentVisit: [],
    history: [],
    winner: null,
  }
}

function buildLegResult(state: GameState, completedVisit: Visit, visitDarts: DartHit[]): LegResult {
  const { players, game, doubleIn, legStarter } = state
  const completedVisits = [...state.history, completedVisit]
  return {
    id: createId('leg'),
    leg: state.legHistory.length + 1,
    winnerName: players[completedVisit.player].name,
    starterName: players[legStarter].name,
    starterIndex: legStarter,
    winningDarts: visitDarts.map((dart) => dart.label).join(' · '),
    game,
    visits: completedVisits.map(cloneVisit),
    playersAtStart: players.map((legPlayer, playerIndex) => {
      const firstVisit = completedVisits.find((visit) => visit.player === playerIndex)
      return {
        ...clonePlayer(legPlayer),
        score: game,
        darts: 0,
        turns: [],
        opened: firstVisit?.previouslyOpened ?? !doubleIn,
      }
    }),
    players: players.map((legPlayer, playerIndex) => {
      const playerVisits = completedVisits
        .map((visit, visitIndex) => ({ visit, visitIndex }))
        .filter(({ visit }) => visit.player === playerIndex)
      const totalScored = playerVisits.reduce((sum, { visit }) => sum + visit.value, 0)
      const totalDarts = playerVisits.reduce((sum, { visit }) => sum + visit.dartCount, 0)
      const lastVisit = playerVisits[playerVisits.length - 1]?.visit
      return {
        id: legPlayer.id,
        name: legPlayer.name,
        average: totalDarts ? totalScored / totalDarts * 3 : 0,
        darts: totalDarts,
        score: lastVisit ? (lastVisit.bust ? lastVisit.previousScore : lastVisit.previousScore - lastVisit.value) : game,
        visits: playerVisits.map(({ visit, visitIndex }) => ({
          visitIndex,
          value: visit.value,
          bust: visit.bust,
          darts: visit.darts.map((dart) => dart.counts ? dart.label : `(${dart.label})`),
          previousScore: visit.previousScore,
          remaining: visit.bust ? visit.previousScore : visit.previousScore - visit.value,
        })),
      }
    }),
  }
}

function submit(state: GameState, entry: string): GameState {
  if (state.winner !== null || state.matchWinner !== null) return state
  const { hits, error } = evaluateEntry(entry, state.currentVisit.length)
  if (error) return state

  const { players, active, currentVisit, doubleIn, doubleOut } = state
  const player = players[active]
  if (!player) return state
  const previousScore = player.score + visitScore(currentVisit)
  const previouslyOpened = currentVisit.some((hit) => hit.openedGame) ? false : player.opened
  const consumed: DartHit[] = []
  let nextScore = player.score
  let opened = player.opened
  let bust = false
  let won = false

  for (const rawHit of hits) {
    const openedGame = doubleIn && !opened && rawHit.isDouble
    const counts = !doubleIn || opened || openedGame
    const hit = { ...rawHit, counts, openedGame }
    consumed.push(hit)
    if (!counts) continue
    if (openedGame) opened = true

    const next = nextScore - hit.value
    if (next < 0 || (doubleOut && next === 1) || (doubleOut && next === 0 && !hit.isDouble)) {
      bust = true
      break
    }
    nextScore = next
    if (next === 0) {
      won = true
      break
    }
  }

  const visitDarts = [...currentVisit, ...consumed]
  const visitComplete = bust || won || visitDarts.length === 3
  const scored = bust ? 0 : previousScore - nextScore

  const nextPlayers = players.map((item, index) => index === active ? {
    ...item,
    score: bust ? previousScore : nextScore,
    darts: item.darts + consumed.length,
    turns: visitComplete ? [...item.turns, scored] : item.turns,
    legs: won ? item.legs + 1 : item.legs,
    opened: bust ? previouslyOpened : opened,
  } : item)

  if (!visitComplete) return { ...state, players: nextPlayers, currentVisit: visitDarts }

  const completedVisit: Visit = {
    player: active,
    value: scored,
    previousScore,
    previouslyOpened,
    bust,
    won,
    darts: visitDarts,
    dartCount: visitDarts.length,
    doubleIn,
    doubleOut,
  }
  const history = [...state.history, completedVisit]

  if (!won) {
    return { ...state, players: nextPlayers, currentVisit: [], history, active: (active + 1) % players.length }
  }

  const legsWon = player.legs + 1
  return {
    ...state,
    players: nextPlayers,
    currentVisit: [],
    history,
    legHistory: [...state.legHistory, buildLegResult(state, completedVisit, visitDarts)],
    winner: active,
    matchWinner: state.legsToWin !== null && legsWon >= state.legsToWin ? active : null,
  }
}

function undo(state: GameState): GameState {
  const { currentVisit, history, active } = state
  if (currentVisit.length) {
    const lastDart = currentVisit[currentVisit.length - 1]
    return {
      ...state,
      currentVisit: currentVisit.slice(0, -1),
      players: state.players.map((player, index) => index === active ? {
        ...player,
        score: player.score + (lastDart.counts ? lastDart.value : 0),
        darts: Math.max(0, player.darts - 1),
        opened: lastDart.openedGame ? false : player.opened,
      } : player),
    }
  }

  const last = history[history.length - 1]
  if (!last) return state

  const editableDarts = last.darts.filter((dart) => !dart.isVisitTotal)
  if (!last.bust && !last.won && editableDarts.length > 0) {
    const retained = editableDarts.slice(0, -1)
    const retainedScore = visitScore(retained)
    const openedAfterRetained = last.previouslyOpened || retained.some((dart) => dart.openedGame)
    return {
      ...state,
      players: state.players.map((player, index) => index === last.player ? {
        ...player,
        score: last.previousScore - retainedScore,
        darts: Math.max(0, player.darts - 1),
        turns: player.turns.slice(0, -1),
        opened: openedAfterRetained,
      } : player),
      history: history.slice(0, -1),
      active: last.player,
      currentVisit: retained,
    }
  }

  return {
    ...state,
    players: state.players.map((player, index) => index === last.player ? {
      ...player,
      score: last.previousScore,
      darts: Math.max(0, player.darts - last.dartCount),
      turns: player.turns.slice(0, -1),
      legs: last.won ? Math.max(0, player.legs - 1) : player.legs,
      opened: last.previouslyOpened,
    } : player),
    history: history.slice(0, -1),
    legHistory: last.won ? state.legHistory.slice(0, -1) : state.legHistory,
    active: last.player,
    winner: null,
    matchWinner: null,
  }
}

function rewind(state: GameState, legId: string, visitIndex: number): GameState {
  const legIndex = state.legHistory.findIndex((leg) => leg.id === legId)
  const leg = state.legHistory[legIndex]
  const targetVisit = leg?.visits[visitIndex]
  if (!leg || !targetVisit) return state

  const restoredPlayers = restorePlayersBeforeVisit(leg, visitIndex).map((player) => ({
    ...player,
    opened: !targetVisit.doubleIn || player.score < leg.game,
  }))
  return {
    ...state,
    players: restoredPlayers,
    game: leg.game,
    doubleIn: targetVisit.doubleIn,
    doubleOut: targetVisit.doubleOut,
    legStarter: leg.starterIndex,
    active: targetVisit.player,
    history: leg.visits.slice(0, visitIndex).map(cloneVisit),
    legHistory: state.legHistory.slice(0, legIndex),
    currentVisit: [],
    winner: null,
    matchWinner: null,
  }
}

function removePlayer(state: GameState, index: number): GameState {
  const { players } = state
  if (players.length <= MIN_PLAYERS || index < 0 || index >= players.length) return state

  let { active, legStarter, winner, matchWinner, currentVisit } = state
  if (index === active) {
    currentVisit = []
    active = Math.min(index, players.length - 2)
  } else if (index < active) {
    active -= 1
  }

  if (index === legStarter) legStarter = Math.min(index, players.length - 2)
  else if (index < legStarter) legStarter -= 1

  if (winner === index) winner = null
  else if (winner !== null && index < winner) winner -= 1

  if (matchWinner === index) matchWinner = null
  else if (matchWinner !== null && index < matchWinner) matchWinner -= 1

  return {
    ...state,
    players: players.filter((_, playerIndex) => playerIndex !== index),
    history: state.history
      .filter((visit) => visit.player !== index)
      .map((visit) => ({ ...visit, player: visit.player > index ? visit.player - 1 : visit.player })),
    active,
    legStarter,
    winner,
    matchWinner,
    currentVisit,
  }
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'submit':
      return submit(state, action.entry)
    case 'undo':
      return undo(state)
    case 'resetLeg':
      if (state.winner !== null) return state
      return resetLegState(state, state.game, state.legStarter, state.doubleIn)
    case 'nextLeg': {
      if (state.winner === null || state.matchWinner !== null) return state
      const nextStarter = (state.legStarter + 1) % state.players.length
      return { ...resetLegState(state, state.game, nextStarter, state.doubleIn), legStarter: nextStarter }
    }
    case 'rewind':
      return rewind(state, action.legId, action.visitIndex)
    case 'setGame':
      if (!GAMES.includes(action.game)) return state
      return { ...resetLegState(state, action.game, 0, state.doubleIn), game: action.game, legStarter: 0 }
    case 'setDoubleIn':
      if (action.value === state.doubleIn) return state
      return {
        ...state,
        doubleIn: action.value,
        players: state.players.map((player) => ({
          ...player,
          opened: action.value ? player.score < state.game : true,
        })),
      }
    case 'setDoubleOut':
      if (action.value === state.doubleOut) return state
      return { ...state, doubleOut: action.value }
    case 'renamePlayer':
      if (!state.players[action.index]) return state
      return { ...state, players: state.players.map((player, index) => index === action.index ? { ...player, name: action.name } : player) }
    case 'addPlayer':
      if (state.players.length >= MAX_PLAYERS) return state
      return {
        ...state,
        players: [...state.players, createPlayer(action.name ?? `Player ${state.players.length + 1}`, state.game, !state.doubleIn)],
      }
    case 'removePlayer':
      return removePlayer(state, action.index)
    default:
      return state
  }
}

/** Actions that keep a recorded online match fair: roster and format are fixed when it is created. */
export const MATCH_ACTION_TYPES = ['submit', 'undo', 'resetLeg', 'nextLeg', 'rewind'] as const satisfies readonly GameAction['type'][]
