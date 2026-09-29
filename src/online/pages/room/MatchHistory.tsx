import { useState } from 'react'
import { History } from 'lucide-react'
import type { MatchSummary, RoomDetail } from '../../../shared/api'
import { api, errorMessage } from '../../api'
import { useResource } from '../../hooks'
import { useSession } from '../../session'
import { EmptyState, ErrorState, Loading } from '../../ui'
import { MatchRow } from '../components/MatchRow'

export function MatchHistory({ room, refreshKey }: { room: RoomDetail; refreshKey: number }) {
  const { user } = useSession()
  const first = useResource(`matches:${room.id}:${refreshKey}`, () => api.roomMatches(room.id))
  const [more, setMore] = useState<{ key: string; matches: MatchSummary[]; hasMore: boolean }>({ key: '', matches: [], hasMore: true })
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (first.loading && !first.data) return <section className="panel"><Loading /></section>
  if (first.error) return <section className="panel"><ErrorState message={first.error.message} onRetry={first.reload} /></section>
  if (!first.data) return null

  const key = `${room.id}:${refreshKey}`
  const extra = more.key === key ? more.matches : []
  const matches = [...first.data.matches, ...extra]
  const hasMore = more.key === key ? more.hasMore : first.data.hasMore

  const loadMore = async () => {
    const last = matches[matches.length - 1]
    if (!last?.completedAt) return
    setLoadingMore(true)
    setError(null)
    try {
      const page = await api.roomMatches(room.id, last.completedAt)
      setMore({ key, matches: [...extra, ...page.matches], hasMore: page.hasMore })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <section className="panel" aria-label="Match history">
      {matches.length === 0 ? (
        <EmptyState icon={<History size={26} />} title="No finished matches">Completed matches and their scorecards will show up here.</EmptyState>
      ) : (
        <div className="match-list">
          {matches.map((match) => <MatchRow key={match.id} match={match} highlightUserId={user?.id} />)}
        </div>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
      {hasMore && matches.length > 0 && (
        <button className="ghost-button load-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'LOADING…' : 'LOAD OLDER MATCHES'}</button>
      )}
    </section>
  )
}
