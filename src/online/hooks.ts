import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { ApiRequestError } from './api'

type Resource<T> = {
  data: T | null
  error: ApiRequestError | null
  loading: boolean
  reload: () => Promise<void>
  setData: (update: T | ((current: T | null) => T | null)) => void
}

/** Loads data for the current key and reloads when the key changes. */
export function useResource<T>(key: string | null, load: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: ApiRequestError | null; loading: boolean }>({
    key,
    data: null,
    error: null,
    loading: key !== null,
  })
  const loadRef = useRef(load)
  useLayoutEffect(() => {
    loadRef.current = load
  })
  const requestId = useRef(0)

  const run = useCallback(async () => {
    if (key === null) return
    const id = ++requestId.current
    setState((current) => ({ ...current, key, loading: true, ...(current.key !== key ? { data: null, error: null } : {}) }))
    try {
      const data = await loadRef.current()
      if (id === requestId.current) setState({ key, data, error: null, loading: false })
    } catch (error) {
      if (id === requestId.current) {
        setState((current) => ({ ...current, key, error: error instanceof ApiRequestError ? error : new ApiRequestError(0, null), loading: false }))
      }
    }
  }, [key])

  useEffect(() => {
    void run()
    return () => { requestId.current += 1 }
  }, [run])

  const setData = useCallback((update: T | ((current: T | null) => T | null)) => {
    setState((current) => ({
      ...current,
      data: typeof update === 'function' ? (update as (value: T | null) => T | null)(current.data) : update,
    }))
  }, [])

  const stale = state.key !== key
  return { data: stale ? null : state.data, error: stale ? null : state.error, loading: stale ? key !== null : state.loading, reload: run, setData }
}

export type StreamStatus = 'connecting' | 'open' | 'reconnecting'

/**
 * Subscribes to a server-sent event stream. EventSource retries on its own; when the server
 * closes the stream for good (for example after a deploy) we reconnect with a back-off.
 */
export function useEventStream<T>(url: string | null, eventName: string, onEvent: (data: T) => void, onDisconnect?: () => void): StreamStatus {
  return useEventStreams(url, { [eventName]: onEvent as (data: unknown) => void }, onDisconnect)
}

/**
 * Like `useEventStream`, for streams that carry several named events (for example `match`,
 * `chat` and `lobby`). Handlers may change between renders; the set of event names may not.
 * `onOpen` runs after every (re)connection, for example to refetch what was missed.
 */
export function useEventStreams(url: string | null, handlers: Record<string, (data: never) => void>, onDisconnect?: () => void, onOpen?: () => void): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>('connecting')
  const handlerRef = useRef(handlers)
  useLayoutEffect(() => {
    handlerRef.current = handlers
  })
  const disconnected = useEffectEvent(() => onDisconnect?.())
  const opened = useEffectEvent(() => onOpen?.())
  const names = Object.keys(handlers).sort().join(',')

  useEffect(() => {
    if (!url) return
    let source: EventSource | null = null
    let retryTimer: number | undefined
    let attempts = 0
    let disposed = false

    const connect = () => {
      if (disposed) return
      source = new EventSource(url, { withCredentials: true })
      source.onopen = () => {
        attempts = 0
        setStatus('open')
        opened()
      }
      for (const name of names.split(',').filter(Boolean)) {
        source.addEventListener(name, (event) => {
          let data: unknown
          try {
            data = JSON.parse((event as MessageEvent<string>).data)
          } catch {
            return // Ignore malformed events.
          }
          handlerRef.current[name]?.(data as never)
        })
      }
      source.addEventListener('match-deleted', () => {
        source?.close()
        disconnected()
      })
      source.onerror = () => {
        disconnected()
        setStatus('reconnecting')
        if (source?.readyState === EventSource.CLOSED) {
          source.close()
          attempts += 1
          retryTimer = window.setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(attempts, 4)))
        }
      }
    }

    connect()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && source?.readyState === EventSource.CLOSED) {
        window.clearTimeout(retryTimer)
        connect()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      window.clearTimeout(retryTimer)
      document.removeEventListener('visibilitychange', onVisible)
      source?.close()
    }
  }, [url, names])

  return status
}

/** Re-renders every `intervalMs` (for countdowns and relative times). */
export function useNow(intervalMs = 1000, enabled = true) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs, enabled])
  return now
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => { document.title = previous }
  }, [title])
}
