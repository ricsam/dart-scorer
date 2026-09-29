export type Player = {
  id: string
  name: string
  score: number
  legs: number
  darts: number
  turns: number[]
  opened: boolean
}

export type DartHit = {
  label: string
  value: number
  isDouble: boolean
  counts: boolean
  openedGame: boolean
  isVisitTotal: boolean
}

export type Visit = {
  player: number
  value: number
  previousScore: number
  previouslyOpened: boolean
  bust: boolean
  won: boolean
  darts: DartHit[]
  dartCount: number
  doubleIn: boolean
  doubleOut: boolean
}

export type LegPlayerHistory = {
  id: string
  name: string
  average: number
  darts: number
  score: number
  visits: {
    visitIndex: number
    value: number
    bust: boolean
    darts: string[]
    previousScore: number
    remaining: number
  }[]
}

export type LegResult = {
  id: string
  leg: number
  winnerName: string
  starterName: string
  starterIndex: number
  winningDarts: string
  game: number
  visits: Visit[]
  playersAtStart: Player[]
  players: LegPlayerHistory[]
}

export type RewindTarget = {
  legId: string
  visitIndex: number
}

export type GameState = {
  game: number
  doubleIn: boolean
  doubleOut: boolean
  /** First player to win this many legs wins the match. `null` plays legs indefinitely. */
  legsToWin: number | null
  players: Player[]
  active: number
  legStarter: number
  currentVisit: DartHit[]
  history: Visit[]
  legHistory: LegResult[]
  /** Index of the player who won the current leg, until the next leg starts. */
  winner: number | null
  /** Index of the player who won the match once `legsToWin` is reached. */
  matchWinner: number | null
}

export type GameAction =
  | { type: 'submit'; entry: string }
  | { type: 'undo' }
  | { type: 'resetLeg' }
  | { type: 'nextLeg' }
  | { type: 'rewind'; legId: string; visitIndex: number }
  | { type: 'setGame'; game: number }
  | { type: 'setDoubleIn'; value: boolean }
  | { type: 'setDoubleOut'; value: boolean }
  | { type: 'renamePlayer'; index: number; name: string }
  | { type: 'addPlayer'; name?: string }
  | { type: 'removePlayer'; index: number }
