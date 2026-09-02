import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  CircleDot,
  Delete,
  Moon,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  Sun,
  Trash2,
  Trophy,
  Undo2,
  Users,
  X,
} from 'lucide-react'

type Player = {
  id: string
  name: string
  score: number
  legs: number
  darts: number
  turns: number[]
  opened: boolean
}

type DartHit = {
  label: string
  value: number
  isDouble: boolean
  counts: boolean
  openedGame: boolean
  isVisitTotal: boolean
}

type Visit = {
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

type LegPlayerHistory = {
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

type LegResult = {
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

type RewindTarget = {
  legId: string
  visitIndex: number
}

type Dart = { label: string; value: number; finish: boolean; rank: number }

const GAMES = [101, 301, 501, 701]
const MAX_PLAYERS = 8

function createPlayer(name: string, score: number, opened = true): Player {
  return {
    id: `player-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    score,
    legs: 0,
    darts: 0,
    turns: [],
    opened,
  }
}

function clonePlayer(player: Player): Player {
  return { ...player, turns: [...player.turns] }
}

function cloneVisit(visit: Visit): Visit {
  return { ...visit, darts: visit.darts.map((dart) => ({ ...dart })) }
}

function restorePlayersBeforeVisit(leg: LegResult, visitIndex: number): Player[] {
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

const darts: Dart[] = [
  ...Array.from({ length: 20 }, (_, i) => ({ label: `T${20 - i}`, value: (20 - i) * 3, finish: false, rank: 100 - i })),
  { label: 'BULL', value: 50, finish: true, rank: 94 },
  ...Array.from({ length: 20 }, (_, i) => ({ label: `D${20 - i}`, value: (20 - i) * 2, finish: true, rank: 80 - i })),
  { label: '25', value: 25, finish: false, rank: 45 },
  ...Array.from({ length: 20 }, (_, i) => ({ label: `${20 - i}`, value: 20 - i, finish: false, rank: 30 - i })),
]

const preferredCheckouts: Record<number, string[]> = {
  2: ['D1'], 3: ['1', 'D1'], 4: ['D2'], 5: ['1', 'D2'], 6: ['D3'], 7: ['3', 'D2'],
  8: ['D4'], 9: ['1', 'D4'], 10: ['D5'], 11: ['3', 'D4'], 12: ['D6'], 13: ['5', 'D4'],
  14: ['D7'], 15: ['7', 'D4'], 16: ['D8'], 17: ['1', 'D8'], 18: ['D9'], 19: ['3', 'D8'],
  20: ['D10'], 21: ['5', 'D8'], 22: ['D11'], 23: ['7', 'D8'], 24: ['D12'], 25: ['9', 'D8'],
  26: ['D13'], 27: ['11', 'D8'], 28: ['D14'], 29: ['13', 'D8'], 30: ['D15'], 31: ['15', 'D8'],
  32: ['D16'], 33: ['1', 'D16'], 34: ['D17'], 35: ['3', 'D16'], 36: ['D18'], 37: ['5', 'D16'],
  38: ['D19'], 39: ['7', 'D16'], 40: ['D20'], 41: ['9', 'D16'], 42: ['10', 'D16'], 43: ['11', 'D16'],
  44: ['12', 'D16'], 45: ['13', 'D16'], 46: ['14', 'D16'], 47: ['15', 'D16'], 48: ['16', 'D16'],
  49: ['17', 'D16'], 50: ['BULL'], 51: ['19', 'D16'], 52: ['20', 'D16'], 53: ['13', 'D20'],
  54: ['14', 'D20'], 55: ['15', 'D20'], 56: ['16', 'D20'], 57: ['17', 'D20'], 58: ['18', 'D20'],
  59: ['19', 'D20'], 60: ['20', 'D20'], 61: ['T15', 'D8'], 62: ['T10', 'D16'], 63: ['T13', 'D12'],
  64: ['T16', 'D8'], 65: ['25', 'D20'], 66: ['T10', 'D18'], 67: ['T17', 'D8'], 68: ['T20', 'D4'],
  69: ['T19', 'D6'], 70: ['T18', 'D8'], 71: ['T13', 'D16'], 72: ['T16', 'D12'], 73: ['T19', 'D8'],
  74: ['T14', 'D16'], 75: ['T17', 'D12'], 76: ['T20', 'D8'], 77: ['T19', 'D10'], 78: ['T18', 'D12'],
  79: ['T13', 'D20'], 80: ['T20', 'D10'], 81: ['T19', 'D12'], 82: ['BULL', 'D16'], 83: ['T17', 'D16'],
  84: ['T20', 'D12'], 85: ['T15', 'D20'], 86: ['T18', 'D16'], 87: ['T17', 'D18'], 88: ['T16', 'D20'],
  89: ['T19', 'D16'], 90: ['T18', 'D18'], 91: ['T17', 'D20'], 92: ['T20', 'D16'], 93: ['T19', 'D18'],
  94: ['T18', 'D20'], 95: ['T19', 'D19'], 96: ['T20', 'D18'], 97: ['T19', 'D20'], 98: ['T20', 'D19'],
  99: ['T19', '10', 'D16'], 100: ['T20', 'D20'],
  170: ['T20', 'T20', 'BULL'], 167: ['T20', 'T19', 'BULL'], 164: ['T20', 'T18', 'BULL'],
  161: ['T20', 'T17', 'BULL'], 160: ['T20', 'T20', 'D20'], 158: ['T20', 'T20', 'D19'],
  157: ['T20', 'T19', 'D20'], 156: ['T20', 'T20', 'D18'], 155: ['T20', 'T19', 'D19'],
  154: ['T20', 'T18', 'D20'], 153: ['T20', 'T19', 'D18'], 152: ['T20', 'T20', 'D16'],
  151: ['T20', 'T17', 'D20'], 150: ['T20', 'T18', 'D18'], 149: ['T20', 'T19', 'D16'],
  148: ['T20', 'T16', 'D20'], 147: ['T20', 'T17', 'D18'], 146: ['T20', 'T18', 'D16'],
  145: ['T20', 'T15', 'D20'], 144: ['T20', 'T20', 'D12'], 143: ['T20', 'T17', 'D16'],
  142: ['T20', 'T14', 'D20'], 141: ['T20', 'T19', 'D12'], 140: ['T20', 'T20', 'D10'],
  139: ['T19', 'T14', 'D20'], 138: ['T20', 'T18', 'D12'], 137: ['T20', 'T19', 'D10'],
  136: ['T20', 'T20', 'D8'], 135: ['BULL', 'T15', 'D20'], 134: ['T20', 'T14', 'D16'],
  133: ['T20', 'T19', 'D8'], 132: ['BULL', 'T14', 'D20'], 131: ['T20', 'T13', 'D16'],
  130: ['T20', 'T20', 'D5'], 129: ['T19', 'T16', 'D12'], 128: ['T18', 'T14', 'D16'],
  127: ['T20', 'T17', 'D8'], 126: ['T19', 'T19', 'D6'], 125: ['BULL', 'T15', 'D15'],
  124: ['T20', 'T16', 'D8'], 123: ['T19', 'T16', 'D9'], 122: ['T18', 'T18', 'D7'],
  121: ['T20', 'T15', 'D8'], 120: ['T20', '20', 'D20'], 119: ['T19', 'T12', 'D13'],
  118: ['T20', '18', 'D20'], 117: ['T20', '17', 'D20'], 116: ['T20', '16', 'D20'],
  115: ['T20', '15', 'D20'], 114: ['T20', '14', 'D20'], 113: ['T20', '13', 'D20'],
  112: ['T20', '12', 'D20'], 111: ['T20', '11', 'D20'], 110: ['T20', '10', 'D20'],
  109: ['T20', '9', 'D20'], 108: ['T20', '8', 'D20'], 107: ['T19', '10', 'D20'],
  106: ['T20', '6', 'D20'], 105: ['T20', '5', 'D20'], 104: ['T18', '10', 'D20'],
  103: ['T19', '6', 'D20'], 102: ['T20', '10', 'D16'], 101: ['T17', '10', 'D20'],
}

function findCheckout(score: number, doubleOut: boolean, maxDarts = 3, requiresDoubleIn = false): string[] | null {
  if (score <= 0 || score > 180 || maxDarts < 1 || (doubleOut && (score === 1 || score > 170))) return null

  // For casual single-out games, prefer the obvious single when one dart can finish.
  if (!doubleOut && !requiresDoubleIn && maxDarts >= 1) {
    if (score >= 1 && score <= 20) return [`${score}`]
    if (score === 25) return ['25']
  }

  if (doubleOut && !requiresDoubleIn && preferredCheckouts[score]?.length <= maxDarts) return preferredCheckouts[score]

  const doubles = darts.filter((dart) => dart.finish)
  const finishers = doubleOut ? doubles : darts
  for (let count = 1; count <= maxDarts; count++) {
    let best: { path: Dart[]; quality: number } | null = null
    const search = (path: Dart[], total: number) => {
      if (path.length === count) {
        if (total !== score || (requiresDoubleIn && !path[0].finish) || (doubleOut && !path[path.length - 1].finish)) return
        const quality = path.reduce((sum, dart, index) => sum + dart.rank * (count - index), 0)
        if (!best || quality > best.quality) best = { path: [...path], quality }
        return
      }
      const isFirst = path.length === 0
      const isLast = path.length === count - 1
      const pool = isFirst && requiresDoubleIn ? doubles : isLast ? finishers : darts
      for (const dart of pool) {
        if (total + dart.value <= score) search([...path, dart], total + dart.value)
      }
    }
    search([], 0)
    if (best) return (best as { path: Dart[] }).path.map((dart) => dart.label)
  }
  return null
}

function findEasyCheckout(score: number, doubleOut: boolean, maxDarts = 3, requiresDoubleIn = false): string[] | null {
  if (score <= 0 || score > 180 || maxDarts < 1 || (doubleOut && (score === 1 || score > 170))) return null

  const doubles = darts.filter((dart) => dart.finish)
  const finishers = doubleOut ? doubles : darts
  let best: { path: Dart[]; effort: number } | null = null

  for (let count = 1; count <= maxDarts; count++) {
    const search = (path: Dart[], total: number) => {
      if (path.length === count) {
        if (total !== score || (requiresDoubleIn && !path[0].finish) || (doubleOut && !path[path.length - 1].finish)) return
        const effort = path.reduce((sum, dart, index) => {
          const requiredDouble = (requiresDoubleIn && index === 0) || (doubleOut && index === path.length - 1)
          const multiplierPenalty = dart.label.startsWith('T') ? 100 : dart.finish && !requiredDouble ? 70 : dart.label === '25' ? 15 : 0
          return sum + multiplierPenalty + 10 + Math.max(0, 20 - Math.min(dart.value, 20)) * 0.01
        }, 0)
        if (!best || effort < best.effort) best = { path: [...path], effort }
        return
      }
      const isFirst = path.length === 0
      const isLast = path.length === count - 1
      const pool = isFirst && requiresDoubleIn ? doubles : isLast ? finishers : darts
      for (const dart of pool) {
        if (total + dart.value <= score) search([...path, dart], total + dart.value)
      }
    }
    search([], 0)
  }

  return best ? (best as { path: Dart[] }).path.map((dart) => dart.label) : null
}

function parseDart(token: string): DartHit | null {
  const normalized = token.trim().toUpperCase()
  if (!normalized) return null
  if (['M', 'MISS', '0'].includes(normalized)) return { label: 'MISS', value: 0, isDouble: false, counts: true, openedGame: false, isVisitTotal: false }
  if (['BULL', 'DB', 'D25', '50'].includes(normalized)) return { label: 'BULL', value: 50, isDouble: true, counts: true, openedGame: false, isVisitTotal: false }
  if (['SB', 'S25', '25'].includes(normalized)) return { label: '25', value: 25, isDouble: false, counts: true, openedGame: false, isVisitTotal: false }
  if (/^\d+$/.test(normalized) && Number(normalized) > 20) {
    return { label: normalized, value: Number(normalized), isDouble: false, counts: true, openedGame: false, isVisitTotal: false }
  }

  const match = normalized.match(/^([SDT]?)(\d{1,2})$/)
  if (!match) return null
  const number = Number(match[2])
  if (number < 1 || number > 20) return null
  const multiplier = match[1] === 'D' ? 2 : match[1] === 'T' ? 3 : 1
  return {
    label: `${match[1] === 'S' ? '' : match[1]}${number}`,
    value: number * multiplier,
    isDouble: match[1] === 'D',
    counts: true,
    openedGame: false,
    isVisitTotal: false,
  }
}

function parseDartEntry(source: string): { hits: DartHit[]; error: string | null } {
  const tokens = source.trim().split(/[\s,+]+/).filter(Boolean)
  if (!tokens.length) return { hits: [parseDart('MISS')!], error: null }
  const hits: DartHit[] = []
  for (const token of tokens) {
    const hit = parseDart(token)
    if (!hit) return { hits: [], error: `“${token}” is not a valid dart.` }
    hits.push(hit)
  }
  if (hits.some((hit) => hit.isVisitTotal) && hits.length > 1) {
    return { hits: [], error: 'Enter a total score by itself.' }
  }
  return { hits, error: null }
}

function App() {
  const [game, setGame] = useState(101)
  const [doubleIn, setDoubleIn] = useState(false)
  const [doubleOut, setDoubleOut] = useState(true)
  const [players, setPlayers] = useState<Player[]>(() => [
    createPlayer('Alex', 101),
    createPlayer('Jamie', 101),
  ])
  const [active, setActive] = useState(0)
  const [legStarter, setLegStarter] = useState(0)
  const [expression, setExpression] = useState('')
  const [currentVisit, setCurrentVisit] = useState<DartHit[]>([])
  const [history, setHistory] = useState<Visit[]>([])
  const [legHistory, setLegHistory] = useState<LegResult[]>([])
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null)
  const [winner, setWinner] = useState<number | null>(null)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)
  const [rewindTarget, setRewindTarget] = useState<RewindTarget | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [draftName, setDraftName] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const savedTheme = window.localStorage.getItem('oche-theme')
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })

  const dartInput = useMemo(() => parseDartEntry(expression), [expression])
  const entryTotal = dartInput.hits.reduce((sum, hit) => sum + hit.value, 0)
  const dartsRemaining = 3 - currentVisit.length
  const entryError = expression.trim() && !dartInput.error && !dartInput.hits[0]?.isVisitTotal && dartInput.hits.length > dartsRemaining
    ? `Only ${dartsRemaining} dart${dartsRemaining === 1 ? '' : 's'} left in this visit.`
    : expression.trim() ? dartInput.error : null
  const scoreInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.localStorage.setItem('oche-theme', theme)
    document.documentElement.style.colorScheme = theme
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const closeModal = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false)
        setSelectedLegId(null)
        setConfirmResetOpen(false)
        setRewindTarget(null)
      }
    }
    window.addEventListener('keydown', closeModal)
    return () => window.removeEventListener('keydown', closeModal)
  }, [])

  const resetLeg = (newGame = game, starter = legStarter, requiresDoubleIn = doubleIn) => {
    setPlayers((current) => current.map((player) => ({ ...player, score: newGame, darts: 0, turns: [], opened: !requiresDoubleIn })))
    setActive(starter)
    setExpression('')
    setCurrentVisit([])
    setHistory([])
    setWinner(null)
  }

  const startNextLeg = () => {
    const nextStarter = (legStarter + 1) % players.length
    setLegStarter(nextStarter)
    resetLeg(game, nextStarter)
  }

  const changeGame = (value: number) => {
    setGame(value)
    setLegStarter(0)
    resetLeg(value, 0)
  }

  const changeInRule = (requiresDouble: boolean) => {
    if (requiresDouble === doubleIn) return
    setDoubleIn(requiresDouble)
    setPlayers((current) => current.map((player) => ({
      ...player,
      opened: requiresDouble ? player.score < game : true,
    })))
  }

  const changeOutRule = (requiresDouble: boolean) => {
    if (requiresDouble === doubleOut) return
    setDoubleOut(requiresDouble)
  }

  const updateExpression = (value: string) => {
    if (/^[a-zA-Z0-9\s,+]*$/.test(value)) setExpression(value.toUpperCase())
  }

  const addDart = (value: string) => {
    setExpression((current) => `${current}${current.trim() ? ' ' : ''}${value}`)
    scoreInputRef.current?.focus()
  }

  const submit = () => {
    if (winner !== null || entryError || dartInput.error) return

    const player = players[active]
    const previousScore = player.score + currentVisit.reduce((sum, hit) => sum + (hit.counts ? hit.value : 0), 0)
    const previouslyOpened = currentVisit.some((hit) => hit.openedGame) ? false : player.opened
    const consumed: DartHit[] = []
    let nextScore = player.score
    let opened = player.opened
    let bust = false
    let won = false

    for (const rawHit of dartInput.hits) {
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
    const dartsAdded = consumed.length
    const visitDartCount = visitDarts.length
    const scored = bust ? 0 : previousScore - nextScore

    setPlayers((current) => current.map((item, index) => index === active ? {
      ...item,
      score: bust ? previousScore : nextScore,
      darts: item.darts + dartsAdded,
      turns: visitComplete ? [...item.turns, scored] : item.turns,
      legs: won ? item.legs + 1 : item.legs,
      opened: bust ? previouslyOpened : opened,
    } : item))
    setExpression('')

    if (visitComplete) {
      const completedVisit: Visit = {
        player: active,
        value: scored,
        previousScore,
        previouslyOpened,
        bust,
        won,
        darts: visitDarts,
        dartCount: visitDartCount,
        doubleIn,
        doubleOut,
      }
      setHistory((current) => [...current, completedVisit])
      setCurrentVisit([])
      if (won) {
        const completedVisits = [...history, completedVisit]
        const visitsSnapshot = completedVisits.map(cloneVisit)
        setLegHistory((current) => [...current, {
          id: `leg-${Date.now()}`,
          leg: current.length + 1,
          winnerName: player.name,
          starterName: players[legStarter].name,
          starterIndex: legStarter,
          winningDarts: visitDarts.map((dart) => dart.label).join(' · '),
          game,
          visits: visitsSnapshot,
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
        }])
        setWinner(active)
      } else setActive((active + 1) % players.length)
    } else {
      setCurrentVisit(visitDarts)
    }
    window.setTimeout(() => scoreInputRef.current?.focus(), 0)
  }

  useEffect(() => {
    const focusScoreEntryOnTyping = (event: KeyboardEvent) => {
      if (editing !== null || settingsOpen || confirmResetOpen || rewindTarget || selectedLegId || winner !== null) return

      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      if (target?.closest('button') && (event.key === ' ' || event.key === 'Enter')) return

      if (event.key.length === 1 && /^[a-zA-Z0-9,+ ]$/.test(event.key)) {
        event.preventDefault()
        scoreInputRef.current?.focus()
        setExpression((current) => `${current}${event.key.toUpperCase()}`)
      } else if (event.key === 'Backspace' && expression) {
        event.preventDefault()
        scoreInputRef.current?.focus()
        setExpression((current) => current.slice(0, -1))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        scoreInputRef.current?.focus()
        submit()
      }
    }

    window.addEventListener('keydown', focusScoreEntryOnTyping)
    return () => window.removeEventListener('keydown', focusScoreEntryOnTyping)
  }, [confirmResetOpen, editing, expression, rewindTarget, selectedLegId, settingsOpen, winner])

  const undo = () => {
    if (currentVisit.length) {
      const lastDart = currentVisit[currentVisit.length - 1]
      setCurrentVisit((current) => current.slice(0, -1))
      setPlayers((current) => current.map((player, index) => index === active ? {
        ...player,
        score: player.score + (lastDart.counts ? lastDart.value : 0),
        darts: Math.max(0, player.darts - 1),
        opened: lastDart.openedGame ? false : player.opened,
      } : player))
      return
    }

    const last = history[history.length - 1]
    if (!last) return

    const editableDarts = last.darts.filter((dart) => !dart.isVisitTotal)
    if (!last.bust && !last.won && editableDarts.length > 0) {
      const retained = editableDarts.slice(0, -1)
      const retainedScore = retained.reduce((sum, dart) => sum + (dart.counts ? dart.value : 0), 0)
      const openedAfterRetained = last.previouslyOpened || retained.some((dart) => dart.openedGame)
      setPlayers((current) => current.map((player, index) => index === last.player ? {
        ...player,
        score: last.previousScore - retainedScore,
        darts: Math.max(0, player.darts - 1),
        turns: player.turns.slice(0, -1),
        opened: openedAfterRetained,
      } : player))
      setHistory((current) => current.slice(0, -1))
      setActive(last.player)
      setCurrentVisit(retained)
      setExpression('')
      window.setTimeout(() => scoreInputRef.current?.focus(), 0)
      return
    }

    setPlayers((current) => current.map((player, index) => index === last.player ? {
      ...player,
      score: last.previousScore,
      darts: Math.max(0, player.darts - last.dartCount),
      turns: player.turns.slice(0, -1),
      legs: last.won ? Math.max(0, player.legs - 1) : player.legs,
      opened: last.previouslyOpened,
    } : player))
    setHistory((current) => current.slice(0, -1))
    if (last.won) setLegHistory((current) => current.slice(0, -1))
    setActive(last.player)
    setWinner(null)
  }

  const requestReset = () => setConfirmResetOpen(true)

  const confirmReset = () => {
    resetLeg()
    setConfirmResetOpen(false)
  }

  const confirmRewind = () => {
    if (!rewindTarget) return
    const legIndex = legHistory.findIndex((leg) => leg.id === rewindTarget.legId)
    const leg = legHistory[legIndex]
    const targetVisit = leg?.visits[rewindTarget.visitIndex]
    if (!leg || !targetVisit) {
      setRewindTarget(null)
      return
    }

    const restoredPlayers = restorePlayersBeforeVisit(leg, rewindTarget.visitIndex).map((player) => ({
      ...player,
      opened: !targetVisit.doubleIn || player.score < leg.game,
    }))
    setPlayers(restoredPlayers)
    setGame(leg.game)
    setDoubleIn(targetVisit.doubleIn)
    setDoubleOut(targetVisit.doubleOut)
    setLegStarter(leg.starterIndex)
    setActive(targetVisit.player)
    setHistory(leg.visits.slice(0, rewindTarget.visitIndex).map(cloneVisit))
    setLegHistory((current) => current.slice(0, legIndex))
    setCurrentVisit([])
    setExpression('')
    setWinner(null)
    setSelectedLegId(null)
    setRewindTarget(null)
    window.setTimeout(() => scoreInputRef.current?.focus(), 0)
  }

  const saveName = () => {
    if (editing === null || !draftName.trim()) return
    setPlayers((current) => current.map((player, index) => index === editing ? { ...player, name: draftName.trim() } : player))
    setEditing(null)
  }

  const updatePlayerName = (index: number, name: string) => {
    setPlayers((current) => current.map((player, playerIndex) => playerIndex === index ? { ...player, name } : player))
  }

  const addPlayer = () => {
    if (players.length >= MAX_PLAYERS) return
    setPlayers((current) => [...current, createPlayer(`Player ${current.length + 1}`, game, !doubleIn)])
  }

  const removePlayer = (index: number) => {
    if (players.length <= 2) return

    setPlayers((current) => current.filter((_, playerIndex) => playerIndex !== index))
    setHistory((current) => current
      .filter((visit) => visit.player !== index)
      .map((visit) => ({ ...visit, player: visit.player > index ? visit.player - 1 : visit.player })))

    if (index === active) {
      setCurrentVisit([])
      setExpression('')
      setActive(Math.min(index, players.length - 2))
    } else if (index < active) {
      setActive((current) => current - 1)
    }

    if (index === legStarter) setLegStarter(Math.min(index, players.length - 2))
    else if (index < legStarter) setLegStarter((current) => current - 1)

    if (winner === index) setWinner(null)
    else if (winner !== null && index < winner) setWinner(winner - 1)
  }

  const quickDarts = ['T20', 'T19', 'T18', 'T17', 'T16', 'D20', 'D18', 'D16', 'D12', 'D10', '20', '19', '18', '17', '16', '25', 'BULL', 'MISS']

  return (
    <div className={`app-shell ${theme}`}>
      <header className="topbar">
        <div className="brand" aria-label="Oche darts scorer">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>OCHE</span>
        </div>
        <div className="match-settings">
          <label className="game-select">
            <span>GAME</span>
            <select value={game} onChange={(event) => changeGame(Number(event.target.value))}>
              {GAMES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <ChevronDown size={15} />
          </label>
          <button className="rules-summary" onClick={() => setSettingsOpen(true)} aria-label="Open in and out rule settings">
            <span>{doubleIn ? 'DOUBLE IN' : 'SINGLE IN'}</span>
            <i />
            <span>{doubleOut ? 'DOUBLE OUT' : 'SINGLE OUT'}</span>
          </button>
        </div>
        <div className="header-actions">
          <button className="icon-button" onClick={undo} disabled={!history.length && !currentVisit.length} aria-label="Undo last dart or visit"><Undo2 size={19} /></button>
          <button className="icon-button" onClick={requestReset} aria-label="Restart leg"><RotateCcw size={19} /></button>
          <button className="icon-button player-settings-button" onClick={() => setSettingsOpen(true)} aria-label={`Manage ${players.length} players`}>
            <Users size={19} /><span>{players.length}</span>
          </button>
          <button
            className={`icon-button ${settingsOpen ? 'selected' : ''}`}
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
          ><Settings2 size={19} /></button>
        </div>
      </header>

      <main>
        <section className={`scoreboard ${players.length > 2 ? 'multi-player' : ''}`}> 
          {players.map((player, index) => {
            const dartsAvailable = index === active ? 3 - currentVisit.length : 3
            const checkout = findCheckout(player.score, doubleOut, dartsAvailable, doubleIn && !player.opened)
            const easyCheckout = findEasyCheckout(player.score, doubleOut, dartsAvailable, doubleIn && !player.opened)
            const showEasyRoute = easyCheckout && checkout && easyCheckout.join('|') !== checkout.join('|')
            const average = player.turns.length ? player.turns.reduce((sum, value) => sum + value, 0) / player.turns.length : 0
            return (
              <article className={`player-card ${active === index && winner === null ? 'active' : ''}`} key={player.id}>
                <div className="player-head">
                  <div>
                    <span className="turn-label">{active === index && winner === null ? (doubleIn && !player.opened ? 'DOUBLE REQUIRED TO START' : 'AT THE OCHE') : 'WAITING'}</span>
                    <button className="player-name" onClick={() => { setEditing(index); setDraftName(player.name) }}>
                      {player.name} <Pencil size={13} />
                    </button>
                  </div>
                  <div className="legs"><strong>{player.legs}</strong><span>LEGS</span></div>
                </div>
                <div className="big-score">{player.score}</div>
                <div className="player-stats">
                  <span><small>3-DART AVG</small><strong>{average.toFixed(1)}</strong></span>
                  <span><small>DARTS</small><strong>{player.darts}</strong></span>
                </div>
                <div className={`checkout ${showEasyRoute ? 'with-easy-route' : ''} ${checkout ? '' : 'no-route'}`}>
                  <div className="checkout-heading"><CircleDot size={15} /><span>CHECKOUT ROUTE · {dartsAvailable} DART{dartsAvailable === 1 ? '' : 'S'} LEFT</span></div>
                  {checkout ? (
                    <>
                      <div className="route">
                        {checkout.map((dart, dartIndex) => (
                          <span key={`${dart}-${dartIndex}`}><b>{dart}</b>{dartIndex < checkout.length - 1 && <i>›</i>}</span>
                        ))}
                      </div>
                      {showEasyRoute && (
                        <div className="easy-route">
                          <small>EASIER</small>
                          <div className="route">
                            {easyCheckout.map((dart, dartIndex) => (
                              <span key={`easy-${dart}-${dartIndex}`}><b>{dart}</b>{dartIndex < easyCheckout.length - 1 && <i>›</i>}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="route-message">{player.score > 170 ? 'Set up your finish' : 'No checkout available'}</div>
                  )}
                </div>
              </article>
            )
          })}
        </section>

        <section className="scoring-zone">
          <div className="turn-context">
            <span className="status-dot" />
            <span>SCORING FOR</span>
            <strong>{players[active].name.toUpperCase()}</strong>
          </div>

          <div className="calculator dart-entry">
            <div className="visit-progress">
              <span>THIS VISIT</span>
              <div className="dart-slots">
                {[0, 1, 2].map((index) => (
                  <span className={currentVisit[index] ? 'filled' : index === currentVisit.length ? 'next' : ''} key={index}>
                    {currentVisit[index]?.label ?? `DART ${index + 1}`}
                  </span>
                ))}
              </div>
              <strong>{currentVisit.reduce((sum, hit) => sum + (hit.counts ? hit.value : 0), 0)}</strong>
            </div>
            <div
              className={`calc-display ${entryError ? 'has-error' : ''}`}
              onClick={() => scoreInputRef.current?.focus()}
            >
              <div className="expression">
                <input
                  ref={scoreInputRef}
                  autoFocus
                  value={expression}
                  onChange={(event) => updateExpression(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      submit()
                    } else if (event.key === 'Escape') {
                      setExpression('')
                    }
                  }}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Enter dart hits"
                  placeholder={dartsRemaining === 3 ? 'e.g. T20 D20 or 20 5 D18' : `Enter dart ${currentVisit.length + 1}`}
                />
              </div>
              <strong className={entryError ? 'invalid' : ''}>{expression ? (entryError ? '—' : entryTotal) : '0'}</strong>
              <button className="clear-key" onClick={() => setExpression('')} aria-label="Clear entry"><Delete size={22} /></button>
            </div>
            {entryError && <div className="entry-error">{entryError}</div>}
            <div className="keypad dart-pad">
              {quickDarts.map((dart) => (
                <button
                  key={dart}
                  className={dart.startsWith('T') ? 'triple' : dart.startsWith('D') || dart === 'BULL' ? 'double' : ''}
                  onClick={() => addDart(dart)}
                  disabled={dartsRemaining === 0}
                >{dart}</button>
              ))}
              <button className="clear-all" onClick={() => setExpression('')}><X size={17} /> CLEAR</button>
              <button className="enter-score" onClick={submit} disabled={Boolean(entryError)}>
                <Check size={20} strokeWidth={3} /> {expression.trim() ? `ADD DART${dartInput.hits.length === 1 ? '' : 'S'}` : 'ADD MISS'}
              </button>
            </div>
            <p className="calc-hint">Type <b>36</b> for one dart; use <b>D18</b> or <b>T12</b> when the ring matters</p>
          </div>

          <aside className="recent-visits">
            <div className="visits-title"><span>RECENT VISITS</span>{(history.length > 0 || currentVisit.length > 0) && <button onClick={undo}>UNDO</button>}</div>
            {legHistory.length > 0 && (
              <div className="leg-history">
                <span>LEG HISTORY</span>
                {legHistory.slice().reverse().map((leg) => (
                  <button key={leg.id} onClick={() => setSelectedLegId(leg.id)} aria-label={`View details for leg ${leg.leg}`}>
                    <span><b>LEG {leg.leg}</b><strong>{leg.winnerName}</strong></span>
                    <small>Started by {leg.starterName} · Tap for details</small>
                    <span className="leg-averages">
                      {leg.players.map((legPlayer) => <i key={legPlayer.id}>{legPlayer.name} <b>{legPlayer.average.toFixed(1)}</b></i>)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {history.length === 0 ? (
              <p>No scores yet.<br />First player is at the oche.</p>
            ) : (
              <div className="visit-list">
                {history.slice(-4).reverse().map((visit, index) => (
                  <div className="visit" key={history.length - index}>
                    <span>{players[visit.player].name}</span>
                    <strong>{visit.bust ? 'BUST' : visit.value}</strong>
                    <small>{visit.darts.map((dart) => dart.counts ? dart.label : `(${dart.label})`).join(' · ')} · {visit.previousScore} → {visit.bust ? visit.previousScore : visit.previousScore - visit.value}</small>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </section>
      </main>

      <footer><span>{players.length} PLAYERS</span><i /> <span>FIRST TO 3 LEGS</span><i /> <span>{doubleIn ? 'DOUBLE IN' : 'SINGLE IN'} · {doubleOut ? 'DOUBLE OUT' : 'SINGLE OUT'}</span><i /> <span>{game} FORMAT</span></footer>

      {selectedLegId && (() => {
        const selectedLeg = legHistory.find((leg) => leg.id === selectedLegId)
        if (!selectedLeg) return null
        return (
          <div className="modal-backdrop" onClick={() => setSelectedLegId(null)}>
            <section className="leg-detail-modal" role="dialog" aria-modal="true" aria-labelledby="leg-detail-title" onClick={(event) => event.stopPropagation()}>
              <div className="settings-modal-head">
                <div>
                  <span>LEG {selectedLeg.leg} · STARTED BY {selectedLeg.starterName.toUpperCase()}</span>
                  <h2 id="leg-detail-title">{selectedLeg.winnerName} won</h2>
                </div>
                <button className="modal-close" onClick={() => setSelectedLegId(null)} aria-label="Close leg details"><X size={19} /></button>
              </div>
              <p className="leg-rewind-hint"><RotateCcw size={13} /> Select a visit to return the game to the start of that turn.</p>
              <div className="leg-detail-players">
                {selectedLeg.players.map((legPlayer) => (
                  <article className={legPlayer.name === selectedLeg.winnerName ? 'winner' : ''} key={legPlayer.id}>
                    <div className="leg-player-summary">
                      <div><strong>{legPlayer.name}</strong><span>{legPlayer.name === selectedLeg.winnerName ? 'LEG WINNER' : `${legPlayer.score} LEFT`}</span></div>
                      <div><small>3-DART AVG</small><b>{legPlayer.average.toFixed(1)}</b></div>
                      <div><small>DARTS</small><b>{legPlayer.darts}</b></div>
                    </div>
                    <div className="leg-visit-list">
                      {legPlayer.visits.length ? legPlayer.visits.map((visit) => (
                        <button
                          type="button"
                          key={`${legPlayer.id}-${visit.visitIndex}`}
                          onClick={() => setRewindTarget({ legId: selectedLeg.id, visitIndex: visit.visitIndex })}
                          aria-label={`Load visit ${visit.visitIndex + 1} by ${legPlayer.name}`}
                        >
                          <span>VISIT {visit.visitIndex + 1}</span>
                          <strong>{visit.bust ? 'BUST' : visit.value}</strong>
                          <small>{visit.darts.join(' · ')}</small>
                          <i>{visit.previousScore} → {visit.remaining}</i>
                          <b><RotateCcw size={12} /> LOAD</b>
                        </button>
                      )) : <p>No darts thrown in this leg.</p>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )
      })()}

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
            <div className="settings-modal-head">
              <div>
                <span>MATCH PREFERENCES</span>
                <h2 id="settings-title">Settings</h2>
              </div>
              <button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={19} /></button>
            </div>

            <div className="settings-section">
              <div className="settings-copy">
                <strong>Appearance</strong>
                <span>Choose how Oche looks on this device.</span>
              </div>
              <div className="theme-options" role="group" aria-label="Color theme">
                <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')} aria-pressed={theme === 'dark'}>
                  <Moon size={18} /> Dark
                </button>
                <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')} aria-pressed={theme === 'light'}>
                  <Sun size={18} /> Light
                </button>
              </div>
            </div>

            <div className="settings-section roster-settings">
              <div className="roster-heading">
                <div className="settings-copy">
                  <strong><Users size={14} /> Players</strong>
                  <span>Add up to {MAX_PLAYERS} players for casual games.</span>
                </div>
                <span className="player-count">{players.length}/{MAX_PLAYERS}</span>
              </div>
              <div className="roster-list">
                {players.map((player, index) => (
                  <div className="roster-player" key={player.id}>
                    <span>{index + 1}</span>
                    <input
                      value={player.name}
                      maxLength={18}
                      aria-label={`Player ${index + 1} name`}
                      onChange={(event) => updatePlayerName(index, event.target.value)}
                      onBlur={() => {
                        if (!player.name.trim()) updatePlayerName(index, `Player ${index + 1}`)
                        else updatePlayerName(index, player.name.trim())
                      }}
                    />
                    <button
                      onClick={() => removePlayer(index)}
                      disabled={players.length <= 2}
                      aria-label={`Remove ${player.name || `Player ${index + 1}`}`}
                    ><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
              <button className="add-player" onClick={addPlayer} disabled={players.length >= MAX_PLAYERS}>
                <Plus size={16} /> {players.length >= MAX_PLAYERS ? 'PLAYER LIMIT REACHED' : 'ADD PLAYER'}
              </button>
            </div>

            <div className="settings-section match-options">
              <div className="settings-copy">
                <strong>Game format</strong>
                <span>Changing the format starts a fresh leg.</span>
              </div>
              <select value={game} onChange={(event) => changeGame(Number(event.target.value))} aria-label="Game format">
                {GAMES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>

            <div className="settings-section rule-settings">
              <div className="settings-copy">
                <strong>In and out rules</strong>
                <span>Rule changes apply immediately without resetting the leg.</span>
              </div>
              <div className="rule-row">
                <div>
                  <strong>Starting rule</strong>
                  <span>{doubleIn ? 'Scoring begins only after hitting a double.' : 'Every scoring dart counts immediately.'}</span>
                </div>
                <div className="rule-options" role="group" aria-label="Starting rule">
                  <button className={!doubleIn ? 'active' : ''} onClick={() => changeInRule(false)} aria-pressed={!doubleIn}>SINGLE IN</button>
                  <button className={doubleIn ? 'active' : ''} onClick={() => changeInRule(true)} aria-pressed={doubleIn}>DOUBLE IN</button>
                </div>
              </div>
              <div className="rule-row">
                <div>
                  <strong>Checkout rule</strong>
                  <span>{doubleOut ? 'The final dart must be a double or inner bull.' : 'Any dart that reaches exactly zero wins.'}</span>
                </div>
                <div className="rule-options" role="group" aria-label="Checkout rule">
                  <button className={!doubleOut ? 'active' : ''} onClick={() => changeOutRule(false)} aria-pressed={!doubleOut}>SINGLE OUT</button>
                  <button className={doubleOut ? 'active' : ''} onClick={() => changeOutRule(true)} aria-pressed={doubleOut}>DOUBLE OUT</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {rewindTarget && (() => {
        const rewindLeg = legHistory.find((leg) => leg.id === rewindTarget.legId)
        const rewindVisit = rewindLeg?.visits[rewindTarget.visitIndex]
        const rewindPlayer = rewindVisit ? rewindLeg?.playersAtStart[rewindVisit.player] : null
        if (!rewindLeg || !rewindVisit || !rewindPlayer) return null
        return (
          <div className="modal-backdrop destructive-backdrop" onClick={() => setRewindTarget(null)}>
            <div className="confirm-modal rewind-modal" role="alertdialog" aria-modal="true" aria-labelledby="rewind-title" onClick={(event) => event.stopPropagation()}>
              <RotateCcw size={30} />
              <span>LOAD PAST VISIT</span>
              <h2 id="rewind-title">Return to visit {rewindTarget.visitIndex + 1}?</h2>
              <p>The game will return to the start of {rewindPlayer.name}’s visit in leg {rewindLeg.leg}. That visit, every visit after it, later legs, and the current leg will be discarded.</p>
              <div>
                <button onClick={() => setRewindTarget(null)}>CANCEL</button>
                <button className="danger" onClick={confirmRewind}>LOAD VISIT</button>
              </div>
            </div>
          </div>
        )
      })()}

      {editing !== null && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="name-modal" onClick={(event) => event.stopPropagation()}>
            <span>PLAYER {editing + 1}</span>
            <h2>Edit player name</h2>
            <input autoFocus onFocus={(event) => event.currentTarget.select()} maxLength={18} value={draftName} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && saveName()} />
            <div><button onClick={() => setEditing(null)}>Cancel</button><button className="save" onClick={saveName}>Save name</button></div>
          </div>
        </div>
      )}

      {confirmResetOpen && (
        <div className="modal-backdrop" onClick={() => setConfirmResetOpen(false)}>
          <div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="reset-title" onClick={(event) => event.stopPropagation()}>
            <RotateCcw size={30} />
            <span>RESTART LEG</span>
            <h2 id="reset-title">Reset the current leg?</h2>
            <p>Scores, darts, and visits for this leg will be cleared. Completed leg history is kept.</p>
            <div>
              <button onClick={() => setConfirmResetOpen(false)}>CANCEL</button>
              <button className="danger" onClick={confirmReset}>RESET LEG</button>
            </div>
          </div>
        </div>
      )}

      {winner !== null && (
        <div className="modal-backdrop winner-backdrop">
          <div className="winner-modal">
            <Trophy size={38} />
            <span>LEG COMPLETE</span>
            <h2>{players[winner].name} wins!</h2>
            <p>Clean finish. {players[(legStarter + 1) % players.length].name} starts the next leg.</p>
            <button onClick={startNextLeg}>START NEXT LEG</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App

