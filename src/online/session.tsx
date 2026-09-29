import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { MeResponse, User } from '../shared/api'
import { api, ApiRequestError } from './api'

type SessionValue = {
  me: MeResponse | null
  user: User | null
  loading: boolean
  error: ApiRequestError | null
  refresh: () => Promise<void>
  setUser: (user: User) => void
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [error, setError] = useState<ApiRequestError | null>(null)

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me())
      setError(null)
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught : new ApiRequestError(0, null))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setUser = useCallback((user: User) => setMe((current) => current ? { ...current, user } : current), [])

  const signOut = useCallback(async () => {
    await api.logout()
    setMe((current) => current ? { ...current, user: null } : current)
  }, [])

  return (
    <SessionContext.Provider value={{ me, user: me?.user ?? null, loading: me === null && error === null, error, refresh, setUser, signOut }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside SessionProvider')
  return value
}
