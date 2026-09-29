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
  const [status, setStatus] = useState<StreamStatus>('connecting')
  const handleEvent = useEffectEvent(onEvent)
  const disconnected = useEffectEvent(() => onDisconnect?.())

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
      }
      source.addEventListener(eventName, (event) => {
        try {
          handleEvent(JSON.parse((event as MessageEvent<string>).data) as T)
        } catch {
          // Ignore malformed events.
        }
      })
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
  }, [url, eventName])

  return status
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => { document.title = previous }
  }, [title])
}
