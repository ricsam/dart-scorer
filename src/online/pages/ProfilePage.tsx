import { useState, type FormEvent } from 'react'
import { Check, LogOut, Pencil, X } from 'lucide-react'
import { api, errorMessage } from '../api'
import { formatAverage, formatBestLeg, formatDate, formatPercent, formatRating } from '../format'
import { useDocumentTitle, useResource } from '../hooks'
import { Link, useRouter } from '../router'
import { useSession } from '../session'
import { Avatar, EmptyState, ErrorState, Loading, StatTile } from '../ui'
import { MatchRow } from './components/MatchRow'

export function ProfilePage() {
  useDocumentTitle('My stats — Oche')
  const { user, setUser, signOut } = useSession()
  const { navigate } = useRouter()
  const stats = useResource(`career:${user?.id}`, () => api.myStats())
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!user) return null

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { user: updated } = await api.updateMe(name.trim())
      setUser(updated)
      setEditing(false)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const totals = stats.data?.totals

  return (
    <div className="page profile-page">
      <div className="profile-head panel">
        <Avatar user={user} size={64} />
        <div className="profile-identity">
          {editing ? (
            <form className="inline-form" onSubmit={save}>
              <input autoFocus value={name} maxLength={24} onChange={(event) => setName(event.target.value)} aria-label="Display name" />
              <button className="icon-button" disabled={busy || !name.trim()} aria-label="Save name"><Check size={16} /></button>
              <button type="button" className="icon-button" onClick={() => { setEditing(false); setName(user.name) }} aria-label="Cancel"><X size={16} /></button>
            </form>
          ) : (
            <h1>{user.name} <button className="inline-icon" onClick={() => { setName(user.name); setEditing(true) }} aria-label="Edit display name"><Pencil size={15} /></button></h1>
          )}
          <span>{user.email} · member since {formatDate(user.createdAt)}</span>
          <small>Your display name is what other players see in rooms and on leaderboards.</small>
          {error && <div className="form-error" role="alert">{error}</div>}
        </div>
        <button className="ghost-button" onClick={async () => { try { await signOut(); navigate('/') } catch (caught) { setError(errorMessage(caught)) } }}><LogOut size={15} /> SIGN OUT</button>
      </div>

      {stats.loading && !stats.data ? <Loading /> : stats.error ? <ErrorState message={stats.error.message} onRetry={stats.reload} /> : totals && stats.data && (
        <>
          <section className="panel">
            <div className="panel-head"><h2>Career</h2><span className="panel-sub">All rooms · completed matches</span></div>
            {totals.matches === 0 ? (
              <EmptyState title="No completed matches yet">Play a match in one of your rooms and save the result to start your career stats.</EmptyState>
            ) : (
              <div className="stat-grid">
                <StatTile label="MATCHES" value={totals.matches} hint={`${totals.wins} W · ${totals.losses} L`} />
                <StatTile label="WIN RATE" value={formatPercent(totals.winRate)} />
                <StatTile label="LEGS" value={`${totals.legsWon}/${totals.legsPlayed}`} hint="won / played" />
                <StatTile label="3-DART AVG" value={formatAverage(totals.average)} />
                <StatTile label="FIRST 9 AVG" value={formatAverage(totals.first9Average)} />
                <StatTile label="CHECKOUT" value={formatPercent(totals.checkoutRate, 1)} hint={`${totals.checkouts}/${totals.checkoutAttempts} darts`} />
                <StatTile label="HIGH OUT" value={totals.highestCheckout || '—'} />
                <StatTile label="BEST LEG" value={formatBestLeg(totals.bestLegDarts)} hint={totals.bestLegDarts ? 'darts' : undefined} />
                <StatTile label="180 / 140+ / 100+" value={`${totals.scores180} / ${totals.scores140} / ${totals.scores100}`} />
              </div>
            )}
          </section>

          {stats.data.rooms.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Rooms</h2></div>
              <div className="profile-rooms">
                {stats.data.rooms.map((room) => (
                  <Link key={room.id} to={`/rooms/${room.id}`} className="profile-room">
                    <b>{room.name}</b>
                    <span><small>RATING</small>{formatRating(room.rating)}</span>
                    <span><small>RANK</small>{room.rank ? `#${room.rank}` : '—'}</span>
                    <span><small>MATCHES</small>{room.matches}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {stats.data.recentMatches.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Recent matches</h2></div>
              <div className="match-list">
                {stats.data.recentMatches.map((match) => <MatchRow key={match.id} match={match} roomName={match.roomName} highlightUserId={user.id} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
