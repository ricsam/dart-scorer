import { useState, type FormEvent } from 'react'
import { Check, LogOut } from 'lucide-react'
import { api, errorMessage } from '../api'
import { formatAverage, formatBestLeg, formatDate, formatPercent, formatRating } from '../format'
import { useDocumentTitle, useResource } from '../hooks'
import { Link, useRouter } from '../router'
import { useSession } from '../session'
import { Avatar, EmptyState, ErrorState, Loading, Segmented, StatTile } from '../ui'
import { MatchRow } from './components/MatchRow'
import { StatsProgress, TrainingTotals } from './components/StatsProgress'

export function ProfilePage() {
  useDocumentTitle('My stats — Oche')
  const { user, setUser, signOut } = useSession()
  const { navigate } = useRouter()
  const stats = useResource(`career:${user?.id}`, () => api.myStats())
  const [name, setName] = useState(user?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [mode, setMode] = useState<'competition' | 'training'>('competition')

  if (!user) return null

  const changed = name.trim() !== user.name
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !name.trim() || !changed) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const { user: updated } = await api.updateMe(name.trim())
      setUser(updated)
      setName(updated.name)
      setSaved(true)
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
          <h1>{user.name}</h1>
          <span>{user.email} · member since {formatDate(user.createdAt)}</span>
          {signOutError && <div className="form-error" role="alert">{signOutError}</div>}
        </div>
        <button className="ghost-button" disabled={busy} onClick={async () => { try { await signOut(); navigate('/') } catch (caught) { setSignOutError(errorMessage(caught)) } }}><LogOut size={15} /> SIGN OUT</button>
      </div>

      <section className="panel" aria-labelledby="nickname-heading">
        <div className="panel-head"><h2 id="nickname-heading">Your player name</h2></div>
        <form className="nickname-form" onSubmit={save} aria-busy={busy}>
          <label className="field" htmlFor="dart-nickname">
            <span>Dart nickname</span>
            <input
              id="dart-nickname"
              name="nickname"
              autoComplete="nickname"
              value={name}
              required
              maxLength={24}
              disabled={busy}
              aria-describedby={`nickname-hint${error ? ' nickname-error' : ''}`}
              onChange={(event) => { setName(event.target.value); setError(null); setSaved(false) }}
            />
          </label>
          <p id="nickname-hint" className="field-hint">1–24 characters. This is the name other players see in leagues, on leaderboards and in new matches. It won’t change your Google account name.</p>
          {error && <div id="nickname-error" className="form-error" role="alert">{error}</div>}
          <div className="nickname-actions">
            <button className="primary-button" disabled={busy || !name.trim() || !changed}><Check size={16} /> {busy ? 'SAVING…' : 'SAVE NICKNAME'}</button>
            <button type="button" className="ghost-button" disabled={busy || name === user.name} onClick={() => { setName(user.name); setError(null); setSaved(false) }}>CANCEL</button>
          </div>
          {saved && <p className="nickname-saved" role="status">Dart nickname saved.</p>}
        </form>
      </section>

      {stats.loading && !stats.data ? <Loading /> : stats.error ? <ErrorState message={stats.error.message} onRetry={stats.reload} /> : totals && stats.data && (
        <>
          <div className="stats-mode"><Segmented label="Stats category" value={mode} options={[{ value: 'competition', label: 'Competition' }, { value: 'training', label: 'Training' }]} onChange={setMode} /></div>
          {mode === 'training' ? <section className="panel" aria-label="Training stats">
            <div className="panel-head"><h2>Training</h2><span className="panel-sub">All leagues · completed bot matches</span></div>
            <p className="stats-mode-note">Bot matches are training-only. They do not affect competition wins, losses or ratings. <Link to="/training">View training challenges & progress</Link></p>
            <TrainingTotals totals={stats.data.training.totals} />
            <StatsProgress history={stats.data.training.history} title="Training monthly average" />
            <h3 className="section-label">RECENT TRAINING MATCHES</h3>
            {stats.data.training.recentMatches.length === 0 ? <p className="muted-note">No completed training matches yet.</p> : <div className="match-list">{stats.data.training.recentMatches.map((match) => <MatchRow key={match.id} match={match} leagueName={match.leagueName} highlightUserId={user.id} />)}</div>}
          </section> : <>
          <section className="panel">
            <div className="panel-head"><h2>Career</h2><span className="panel-sub">All leagues · completed matches</span></div>
            <p className="table-footnote stats-guide"><Link to="/about">How ratings & stats work</Link></p>
            {totals.matches === 0 ? (
              <EmptyState title="No completed matches yet">Play a match in one of your leagues and save the result to start your career stats.</EmptyState>
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
            <StatsProgress history={stats.data.history} title="Competition monthly average" />
          </section>

          {stats.data.leagues.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Leagues</h2></div>
              <div className="profile-leagues">
                {stats.data.leagues.map((league) => (
                  <Link key={league.id} to={`/leagues/${league.id}`} className="profile-league">
                    <b>{league.name}</b>
                    <span><small>RATING</small>{formatRating(league.rating)}</span>
                    <span><small>RANK</small>{league.rank ? `#${league.rank}` : '—'}</span>
                    <span><small>MATCHES</small>{league.matches}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {stats.data.recentMatches.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Recent matches</h2></div>
              <div className="match-list">
                {stats.data.recentMatches.map((match) => <MatchRow key={match.id} match={match} leagueName={match.leagueName} highlightUserId={user.id} />)}
              </div>
            </section>
          )}
          </>}
        </>
      )}
    </div>
  )
}
