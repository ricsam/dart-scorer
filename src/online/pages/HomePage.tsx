import { useState, type FormEvent } from 'react'
import { DoorOpen, Plus, Radio, Target, Trophy, Users } from 'lucide-react'
import type { LeagueSummary } from '../../shared/api'
import { api, errorMessage } from '../api'
import { formatAverage, formatPercent, formatRating, inviteCodeFrom, relativeTime } from '../format'
import { useDocumentTitle, useResource } from '../hooks'
import { Link, useRouter } from '../router'
import { useSession } from '../session'
import { AvatarStack, EmptyState, ErrorState, Loading, Sheet, StatTile } from '../ui'
import { MatchRow } from './components/MatchRow'

export function HomePage() {
  useDocumentTitle('Your leagues — Oche')
  const { user } = useSession()
  const leagues = useResource(`leagues:${user?.id}`, () => api.leagues())
  const stats = useResource(user?.guest ? null : `me-stats:${user?.id}`, () => api.myStats())
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)

  return (
    <div className="page home-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">{user?.guest ? 'PLAYING AS A GUEST' : 'WELCOME BACK'}</span>
          <h1>{user?.name ?? 'Player'}</h1>
        </div>
        <div className="page-actions">
          <button className="ghost-button" onClick={() => setJoining(true)}><DoorOpen size={16} /> JOIN LEAGUE</button>
          {!user?.guest && <button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} /> NEW LEAGUE</button>}
        </div>
      </div>

      <div className="home-grid">
        <section className="panel leagues-panel" aria-labelledby="leagues-heading">
          <div className="panel-head">
            <h2 id="leagues-heading">Your leagues</h2>
            {leagues.data && <span className="panel-count">{leagues.data.leagues.length}</span>}
          </div>
          {leagues.loading && !leagues.data ? <Loading /> : leagues.error ? <ErrorState message={leagues.error.message} onRetry={leagues.reload} /> : leagues.data && leagues.data.leagues.length === 0 ? (
            <EmptyState icon={<Users size={28} />} title="No leagues yet">
              {user?.guest ? 'You no longer belong to a league. Open an invite link to join, or sign in for a persistent account.' : 'Create a league for your club, office or pub team and share the invite link. Every match played there feeds the league’s leaderboard.'}
            </EmptyState>
          ) : (
            <div className="league-grid">
              {leagues.data?.leagues.map((league) => <LeagueCard league={league} key={league.id} guest={user?.guest} />)}
            </div>
          )}
          <Link to="/play" className="quick-game-card">
            <Target size={20} />
            <span><b>Quick game</b><small>Score a casual game on this device without saving it.</small></span>
            <i>→</i>
          </Link>
        </section>

        <aside className="home-side">
          {user?.guest ? <section className="panel guest-info">
            <h2>No account needed to play</h2>
            <p className="muted-note">You can play and score in your league. Guests aren’t ranked and don’t have a personal stats profile.</p>
            <p className="muted-note">Keep using this browser to return as the same guest. Signing out or clearing cookies loses access to this identity.</p>
            <Link className="text-link" to="/login">SIGN IN FOR AN ACCOUNT →</Link>
          </section> : <>
          <section className="panel" aria-labelledby="career-heading">
            <div className="panel-head">
              <h2 id="career-heading">Your numbers</h2>
              <Link to="/me" className="text-link">ALL STATS →</Link>
            </div>
            {stats.loading && !stats.data ? <Loading /> : stats.data ? (
              stats.data.totals.matches === 0 ? (
                <p className="muted-note">Finish a match in a league to start building your stats.</p>
              ) : (
                <div className="stat-grid compact">
                  <StatTile label="MATCHES" value={stats.data.totals.matches} hint={`${stats.data.totals.wins} won`} />
                  <StatTile label="WIN RATE" value={formatPercent(stats.data.totals.winRate)} />
                  <StatTile label="3-DART AVG" value={formatAverage(stats.data.totals.average)} />
                  <StatTile label="CHECKOUT" value={formatPercent(stats.data.totals.checkoutRate)} />
                  <StatTile label="180S" value={stats.data.totals.scores180} />
                  <StatTile label="HIGH OUT" value={stats.data.totals.highestCheckout || '—'} />
                </div>
              )
            ) : null}
          </section>
          {stats.data && stats.data.recentMatches.length > 0 && (
            <section className="panel" aria-labelledby="recent-heading">
              <div className="panel-head"><h2 id="recent-heading">Recent matches</h2></div>
              <div className="match-list">
                {stats.data.recentMatches.slice(0, 5).map((match) => <MatchRow match={match} leagueName={match.leagueName} key={match.id} highlightUserId={user?.id} />)}
              </div>
            </section>
          )}
          </>}
        </aside>
      </div>

      {creating && <CreateLeagueDialog onClose={() => setCreating(false)} />}
      {joining && <JoinLeagueDialog onClose={() => setJoining(false)} />}
    </div>
  )
}

function LeagueCard({ league, guest = false }: { league: LeagueSummary; guest?: boolean }) {
  return (
    <Link to={`/leagues/${league.id}`} className="league-card">
      <div className="league-card-top">
        <strong>{league.name}</strong>
        {league.liveMatches > 0 && <span className="live-pill"><Radio size={11} /> {league.liveMatches} LIVE</span>}
      </div>
      <div className="league-card-members">
        <AvatarStack users={league.members} />
        <span>{league.memberCount} {league.memberCount === 1 ? 'member' : 'members'}</span>
      </div>
      <div className="league-card-stats">
        <span><small>YOUR RATING</small><b>{guest ? 'Unranked' : formatRating(league.myRating)}</b></span>
        <span><small>RANK</small><b>{!guest && league.myRank ? `#${league.myRank}` : '—'}</b></span>
        <span><small>MATCHES</small><b>{league.completedMatches}</b></span>
      </div>
      <small className="league-card-foot"><Trophy size={11} /> {guest ? 'Guest' : league.role === 'owner' ? 'You host this league' : 'Member'} · active {relativeTime(league.lastActivityAt)}</small>
    </Link>
  )
}

function CreateLeagueDialog({ onClose }: { onClose: () => void }) {
  const { navigate } = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const { league } = await api.createLeague(name.trim())
      navigate(`/leagues/${league.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <Sheet title="New league" eyebrow="CREATE A LEAGUE" onClose={onClose} labelledBy="create-league-title">
      <form className="sheet-form" onSubmit={submit}>
        <label className="field">
          <span>League name</span>
          <input autoFocus value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="e.g. Friday Oche Club" />
        </label>
        <p className="field-hint">You’ll get an invite link to share once the league is created.</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="sheet-actions">
          <button type="button" className="ghost-button" onClick={onClose}>CANCEL</button>
          <button className="primary-button" disabled={busy || !name.trim()}>CREATE LEAGUE</button>
        </div>
      </form>
    </Sheet>
  )
}

function JoinLeagueDialog({ onClose }: { onClose: () => void }) {
  const { navigate } = useRouter()
  const [value, setValue] = useState('')
  const code = inviteCodeFrom(value)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (code) navigate(`/join/${code}`)
  }

  return (
    <Sheet title="Join a league" eyebrow="INVITE LINK OR CODE" onClose={onClose} labelledBy="join-league-title">
      <form className="sheet-form" onSubmit={submit}>
        <label className="field">
          <span>Invite link or code</span>
          <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://…/join/ABC123 or ABC123" />
        </label>
        {value && !code && <div className="form-error" role="alert">That doesn’t look like an invite link.</div>}
        <div className="sheet-actions">
          <button type="button" className="ghost-button" onClick={onClose}>CANCEL</button>
          <button className="primary-button" disabled={!code}>CONTINUE</button>
        </div>
      </form>
    </Sheet>
  )
}
