import { useState, type FormEvent } from 'react'
import { DoorOpen, Plus, Radio, Trophy, Users } from 'lucide-react'
import type { LeagueSummary } from '../../shared/api'
import { api, errorMessage } from '../api'
import { formatRating, inviteCodeFrom, relativeTime } from '../format'
import { useDocumentTitle, useResource } from '../hooks'
import { Link, useRouter } from '../router'
import { useSession } from '../session'
import { AvatarStack, EmptyState, ErrorState, Loading, Sheet } from '../ui'

/** Leagues: persistent groups with their own leaderboard, ratings and match history. */
export function LeaguesPage() {
  useDocumentTitle('Leagues — Oche')
  const { user } = useSession()
  return (
    <div className="page leagues-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">COMPETE WITH YOUR CREW</span>
          <h1>Leagues</h1>
          <p className="training-intro">A league keeps a running table for your club, office or pub team: ratings, averages, head-to-heads and every match played together.</p>
        </div>
      </div>
      <LeaguesPanel guest={user?.guest} />
    </div>
  )
}

/** League cards with create/join actions; `limit` shows only the most recently active ones. */
export function LeaguesPanel({ guest = false, limit }: { guest?: boolean; limit?: number }) {
  const { user } = useSession()
  const leagues = useResource(`leagues:${user?.id}`, () => api.leagues())
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const list = leagues.data?.leagues ?? []
  const shown = limit ? list.slice(0, limit) : list

  return (
    <section className="panel leagues-panel" aria-labelledby="leagues-heading">
      <div className="panel-head">
        <h2 id="leagues-heading">Your leagues {leagues.data && <span className="panel-count">{list.length}</span>}</h2>
        <div className="page-actions">
          <button className="ghost-button" onClick={() => setJoining(true)}><DoorOpen size={15} /> JOIN</button>
          {!guest && <button className="ghost-button" onClick={() => setCreating(true)}><Plus size={15} /> NEW LEAGUE</button>}
        </div>
      </div>
      {leagues.loading && !leagues.data ? <Loading /> : leagues.error ? <ErrorState message={leagues.error.message} onRetry={leagues.reload} /> : list.length === 0 ? (
        <EmptyState icon={<Users size={28} />} title="No leagues yet">
          {guest ? 'You no longer belong to a league. Open an invite link to join, or sign in for a persistent account.' : 'Create a league for your club, office or pub team and share the invite link. Every match played there feeds the league’s leaderboard.'}
        </EmptyState>
      ) : (
        <div className="league-grid">
          {shown.map((league) => <LeagueCard league={league} key={league.id} guest={guest} />)}
        </div>
      )}
      {limit && list.length > limit && <Link className="text-link" to="/leagues">ALL {list.length} LEAGUES →</Link>}
      {creating && <CreateLeagueDialog onClose={() => setCreating(false)} />}
      {joining && <JoinLeagueDialog onClose={() => setJoining(false)} />}
    </section>
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
