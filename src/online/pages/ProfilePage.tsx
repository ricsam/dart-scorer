import { useEffect, useState, type FormEvent } from 'react'
import { Check, Globe2, LogOut, Trophy } from 'lucide-react'
import type { CareerStatsResponse } from '../../shared/api'
import { api, errorMessage } from '../api'
import { formatAverage, formatBestLeg, formatDate, formatPercent, formatRating } from '../format'
import { useDocumentTitle, useResource } from '../hooks'
import { Link, useRouter } from '../router'
import { useSession } from '../session'
import { Avatar, EmptyState, ErrorState, Loading, Segmented, StatTile } from '../ui'
import { RatingChart, TrendChart } from './components/Charts'
import { MatchRow } from './components/MatchRow'
import { StatsProgress, TrainingTotals } from './components/StatsProgress'

type Mode = 'all' | 'competition' | 'training'

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
  const [mode, setMode] = useState<Mode>('all')

  // The account menu links to /me#nickname: bring the editor into view once the page has settled.
  useEffect(() => {
    if (window.location.hash !== '#nickname' || stats.loading) return
    const field = document.getElementById('dart-nickname') as HTMLInputElement | null
    field?.scrollIntoView({ block: 'center' })
    field?.focus()
  }, [stats.loading])

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

      {stats.loading && !stats.data ? <Loading /> : stats.error ? <ErrorState message={stats.error.message} onRetry={stats.reload} /> : stats.data && (
        <>
          <GlobalRatingPanel data={stats.data} />
          <div className="stats-mode"><Segmented label="Stats category" value={mode} options={[{ value: 'all', label: 'All games' }, { value: 'competition', label: 'Competition' }, { value: 'training', label: 'Training' }]} onChange={setMode} /> <Link className="text-link stats-guide-link" to="/about">How ratings & stats work</Link></div>
          {mode === 'all' && <AllGames data={stats.data} />}
          {mode === 'training' && <section className="panel" aria-label="Training stats">
            <div className="panel-head"><h2>Training</h2><span className="panel-sub">Solo games and bot games</span></div>
            <p className="stats-mode-note">Practice on your own or against house bots. Training never affects wins, losses or ratings. <Link to="/training">Training challenges & progress</Link></p>
            <TrainingTotals totals={stats.data.training.totals} />
            <StatsProgress history={stats.data.training.history} title="Training monthly average" />
            <h3 className="section-label">RECENT TRAINING GAMES</h3>
            {stats.data.training.recentMatches.length === 0 ? <p className="muted-note">No training games yet. <Link to="/play">Start a solo game</Link> to begin.</p> : <div className="match-list">{stats.data.training.recentMatches.map((match) => <MatchRow key={match.id} match={match} leagueName={match.leagueName} highlightUserId={user.id} />)}</div>}
          </section>}
          {mode === 'competition' && <Competition data={stats.data} userId={user.id} />}
        </>
      )}

      <section className="panel" id="nickname" aria-labelledby="nickname-heading">
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
          <p id="nickname-hint" className="field-hint">1–24 characters. This is the name other players see in lobbies, leagues, rankings and new matches. It won’t change your Google account name.</p>
          {error && <div id="nickname-error" className="form-error" role="alert">{error}</div>}
          <div className="nickname-actions">
            <button className="primary-button" disabled={busy || !name.trim() || !changed}><Check size={16} /> {busy ? 'SAVING…' : 'SAVE NICKNAME'}</button>
            <button type="button" className="ghost-button" disabled={busy || name === user.name} onClick={() => { setName(user.name); setError(null); setSaved(false) }}>CANCEL</button>
          </div>
          {saved && <p className="nickname-saved" role="status">Dart nickname saved.</p>}
        </form>
      </section>
    </div>
  )
}

function GlobalRatingPanel({ data }: { data: CareerStatsResponse }) {
  const { global } = data
  return (
    <section className="panel" aria-labelledby="global-rating-heading">
      <div className="panel-head"><h2 id="global-rating-heading"><Globe2 size={18} className="title-icon" /> Global rating</h2><Link className="text-link" to="/global">RANKINGS →</Link></div>
      <div className="stat-grid">
        <StatTile label="RATING" value={global.rating} hint={global.matches ? undefined : 'Starts at 1000'} />
        <StatTile label="RANK" value={global.rank ? `#${global.rank}` : '—'} hint={global.rank ? undefined : 'After your first ranked game'} />
        <StatTile label="RANKED GAMES" value={global.matches} hint={`${global.wins} W · ${global.losses} L`} />
      </div>
      <RatingChart points={global.history} emptyText={global.matches ? 'The chart appears after two ranked games.' : 'Play ranked games in a lobby to earn a global rating. Open one from Play or join one on the Global page.'} />
    </section>
  )
}

function AllGames({ data }: { data: CareerStatsResponse }) {
  const totals = data.all.totals
  return (
    <section className="panel" aria-label="All games">
      <div className="panel-head"><h2>All games</h2><span className="panel-sub">Competition and training together</span></div>
      {totals.matches === 0 ? (
        <EmptyState title="No games yet">Every saved game counts here, including solo practice. <Link to="/play">Play your first game</Link>.</EmptyState>
      ) : (
        <>
          <div className="stat-grid">
            <StatTile label="GAMES" value={totals.matches} hint={`${totals.legsPlayed} legs`} />
            <StatTile label="3-DART AVG" value={formatAverage(totals.average)} />
            <StatTile label="FIRST 9 AVG" value={formatAverage(totals.first9Average)} />
            <StatTile label="CHECKOUT" value={formatPercent(totals.checkoutRate, 1)} hint={`${totals.checkouts}/${totals.checkoutAttempts} darts`} />
            <StatTile label="HIGH OUT" value={totals.highestCheckout || '—'} />
            <StatTile label="BEST LEG" value={formatBestLeg(totals.bestLegDarts)} hint={totals.bestLegDarts ? 'darts' : undefined} />
            <StatTile label="180 / 140+ / 100+" value={`${totals.scores180} / ${totals.scores140} / ${totals.scores100}`} />
          </div>
          <TrendChart points={data.trend} />
          <StatsProgress history={data.all.history} title="Monthly average · all games" />
        </>
      )}
    </section>
  )
}

function Competition({ data, userId }: { data: CareerStatsResponse; userId: string }) {
  const totals = data.totals
  return (
    <>
      <section className="panel">
        <div className="panel-head"><h2>Competition</h2><span className="panel-sub">Saved matches against other people</span></div>
        <p className="table-footnote stats-guide">League matches and lobby games against at least one other person, without bots.</p>
        {totals.matches === 0 ? (
          <EmptyState title="No completed matches yet">Invite a friend from <Link to="/play">Play</Link>, join a public lobby, or play a match in one of your leagues.</EmptyState>
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
        <StatsProgress history={data.history} title="Competition monthly average" />
      </section>

      {data.leagues.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2><Trophy size={18} className="title-icon" /> Leagues</h2></div>
          <div className="profile-leagues">
            {data.leagues.map((league) => (
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

      {data.recentMatches.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Recent matches</h2></div>
          <div className="match-list">
            {data.recentMatches.map((match) => <MatchRow key={match.id} match={match} leagueName={match.leagueName} highlightUserId={userId} />)}
          </div>
        </section>
      )}
    </>
  )
}
