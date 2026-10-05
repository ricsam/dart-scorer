import { useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '../api'
import { useDocumentTitle } from '../hooks'
import { useRouter } from '../router'
import { ErrorState, Loading } from '../ui'

/**
 * "Play" takes you to your lobby, creating one with your last format if you are not in one.
 * From there you can start a solo game straight away, add a bot, or invite people.
 */
export function PlayPage() {
  useDocumentTitle('Play — Oche')
  const { navigate, search } = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const started = useRef(-1)

  useEffect(() => {
    if (started.current === attempt) return
    started.current = attempt
    const params = new URLSearchParams(search)
    const visibility = params.get('public') ? 'public' as const : undefined
    void (async () => {
      try {
        const { lobby: current } = await api.currentLobby()
        let lobby = current
        if (lobby && visibility && lobby.role === 'leader' && lobby.visibility !== visibility) lobby = (await api.updateLobby(lobby.id, { visibility })).lobby
        if (!lobby || (visibility && lobby.role !== 'leader')) lobby = (await api.createLobby(visibility ? { visibility } : {})).lobby
        params.delete('public')
        const rest = params.toString()
        navigate(`/lobbies/${lobby.id}${rest ? `?${rest}` : ''}`, { replace: true })
      } catch (caught) {
        setError(errorMessage(caught))
      }
    })()
  }, [attempt, navigate, search])

  if (error) return <ErrorState message={error} onRetry={() => { setError(null); setAttempt((value) => value + 1) }} />
  return <Loading label="Setting up your lobby…" />
}
