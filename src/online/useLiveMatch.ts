import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { reduceMatchAction } from '../shared/match-reducer'
import type { GameAction, GameState } from '../game/types'
import type { ChatEvent, LobbyEvent, MatchConflictResponse, MatchDetail, MatchEvent } from '../shared/api'
import { api, ApiRequestError, errorMessage } from './api'
import { useEventStreams, type StreamStatus } from './hooks'

function isNewer(next: MatchDetail, current: MatchDetail | null) {
  if (!current) return true
  if (next.version !== current.version) return next.version > current.version
  return next.updatedAt >= current.updatedAt
}

export type LiveMatch = {
  match: MatchDetail | null
  /** Server state with this device's unconfirmed actions applied on top. */
  state: GameState | null
  loadError: ApiRequestError | null
  stream: StreamStatus
  syncing: boolean
  notice: string | null
  dismissNotice: () => void
  dispatch: (action: GameAction) => void
  finish: () => Promise<void>
  /** Concede your own slot, or claim the idle opponent's slot. */
  forfeit: (slot: number) => Promise<boolean>
  reload: () => Promise<void>
}

type LiveMatchOptions = {
  /** Chat messages delivered on the match stream. */
  onChat?: (event: ChatEvent) => void
  /** Lobby events (a lobby match's next game started). */
  onLobby?: (event: LobbyEvent) => void
  /** After the stream (re)connects, for example to refetch missed chat. */
  onReconnect?: () => void
}

/**
 * Keeps a recorded match in sync with the server. Actions are applied optimistically and sent
 * one at a time with the version they were based on; a stale version (another device scored
 * first) discards the local queue and adopts the server's state.
 */
export function useLiveMatch(matchId: string, options: LiveMatchOptions = {}): LiveMatch {
  const [match, setMatch] = useState<MatchDetail | null>(null)
  const [queue, setQueue] = useState<GameAction[]>([])
  const [loadError, setLoadError] = useState<ApiRequestError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const latest = useRef<MatchDetail | null>(null)
  const pending = useRef<GameAction[]>([])
  const buffered = useRef<MatchDetail | null>(null)
  const busy = useRef(false)

  const accept = useCallback((next: MatchDetail) => {
    if (!isNewer(next, latest.current)) return
    latest.current = next
    setMatch(next)
  }, [])

  const reload = useCallback(async () => {
    try {
      const { match: loaded } = await api.match(matchId)
      accept(loaded)
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof ApiRequestError ? error : new ApiRequestError(0, null))
      if (error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) {
        latest.current = null
        buffered.current = null
        pending.current = []
        setMatch(null)
        setQueue([])
      }
    }
  }, [accept, matchId])

  useEffect(() => {
    latest.current = null
    pending.current = []
    buffered.current = null
    setMatch(null)
    setQueue([])
    void reload()
  }, [reload])

  const stream = useEventStreams(loadError && [401, 403, 404].includes(loadError.status) ? null : `/api/matches/${encodeURIComponent(matchId)}/events`, {
    match: ({ match: next }: MatchEvent) => {
      // While one of our own actions is in flight the broadcast of it may arrive first;
      // hold it back so the optimistic copy is not applied twice.
      if (busy.current) {
        if (!buffered.current || isNewer(next, buffered.current)) buffered.current = next
        return
      }
      accept(next)
    },
    chat: (event: ChatEvent) => options.onChat?.(event),
    lobby: (event: LobbyEvent) => options.onLobby?.(event),
  }, () => { if (!busy.current) void reload() }, options.onReconnect)

  const flushBuffered = useCallback(() => {
    if (buffered.current) {
      accept(buffered.current)
      buffered.current = null
    }
  }, [accept])

  const pump = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setSyncing(true)
    try {
      while (pending.current.length && latest.current) {
        const action = pending.current[0]
        try {
          const { match: next } = await api.matchAction(matchId, { action, baseVersion: latest.current.version })
          accept(next)
          pending.current = pending.current.slice(1)
          setQueue(pending.current)
        } catch (error) {
          pending.current = []
          setQueue([])
          const conflict = error instanceof ApiRequestError && error.status === 409 ? (error.body as MatchConflictResponse | null)?.match : null
          if (conflict) {
            accept(conflict)
            setNotice('The match was updated on another device. Your last entry was not saved — check the board and enter it again.')
          } else {
            setNotice(errorMessage(error))
            buffered.current = null
            await reload()
          }
        }
      }
    } finally {
      busy.current = false
      setSyncing(false)
      flushBuffered()
    }
  }, [accept, flushBuffered, matchId, reload])

  const dispatch = useCallback((action: GameAction) => {
    if (!latest.current?.canScore || latest.current.status !== 'live') return
    const current = latest.current
    const projected = pending.current.reduce((state, queued) => reduceMatchAction(state, queued, current.players), current.state)
    if (action.type === 'submit' && (current.players[projected.active]?.botId || !current.controlledSlots.includes(projected.active))) return
    pending.current = [...pending.current, action]
    setQueue(pending.current)
    void pump()
  }, [pump])

  const finish = useCallback(async () => {
    if (busy.current || !latest.current || pending.current.length) return
    busy.current = true
    setSyncing(true)
    try {
      const { match: next } = await api.finishMatch(matchId, latest.current.version)
      accept(next)
    } catch (error) {
      const conflict = error instanceof ApiRequestError && error.status === 409 ? (error.body as MatchConflictResponse | null)?.match : null
      if (conflict) accept(conflict)
      // Saved automatically or by another player a moment earlier: the stream brings the result.
      if (!(error instanceof ApiRequestError && error.status === 400 && /already finished/.test(error.message))) setNotice(errorMessage(error))
      else void reload()
    } finally {
      busy.current = false
      setSyncing(false)
      flushBuffered()
    }
  }, [accept, flushBuffered, matchId, reload])

  const forfeit = useCallback(async (slot: number) => {
    if (busy.current || !latest.current || pending.current.length) return false
    busy.current = true
    setSyncing(true)
    try {
      const { match: next } = await api.forfeitMatch(matchId, latest.current.version, slot)
      accept(next)
      return true
    } catch (error) {
      const conflict = error instanceof ApiRequestError && error.status === 409 ? (error.body as MatchConflictResponse | null)?.match : null
      if (conflict) accept(conflict)
      setNotice(errorMessage(error))
      return false
    } finally {
      busy.current = false
      setSyncing(false)
      flushBuffered()
    }
  }, [accept, flushBuffered, matchId])

  const state = useMemo(() => match ? queue.reduce((state, action) => reduceMatchAction(state, action, match.players), match.state) : null, [match, queue])

  return {
    match,
    state,
    loadError,
    stream,
    syncing: syncing || queue.length > 0,
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    dispatch,
    finish,
    forfeit,
    reload,
  }
}
