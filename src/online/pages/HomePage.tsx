import { useState, type FormEvent } from 'react'
import { DoorOpen, Plus, Radio, Target, Trophy, Users } from 'lucide-react'
import type { RoomSummary } from '../../shared/api'
import { api, errorMessage } from '../api'
import { formatAverage, formatPercent, formatRating, inviteCodeFrom, relativeTime } from '../format'
import { useDocumentTitle, useResource } from '../hooks'
import { Link, useRouter } from '../router'
import { useSession } from '../session'
import { AvatarStack, EmptyState, ErrorState, Loading, Sheet, StatTile } from '../ui'
import { MatchRow } from './components/MatchRow'

export function HomePage() {
  useDocumentTitle('Your rooms — Oche')
  const { user } = useSession()
  const rooms = useResource(`rooms:${user?.id}`, () => api.rooms())
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
          <button className="ghost-button" onClick={() => setJoining(true)}><DoorOpen size={16} /> JOIN ROOM</button>
          {!user?.guest && <button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} /> NEW ROOM</button>}
        </div>
      </div>

      <div className="home-grid">
        <section className="panel rooms-panel" aria-labelledby="rooms-heading">
          <div className="panel-head">
            <h2 id="rooms-heading">Your rooms</h2>
            {rooms.data && <span className="panel-count">{rooms.data.rooms.length}</span>}
          </div>
          {rooms.loading && !rooms.data ? <Loading /> : rooms.error ? <ErrorState message={rooms.error.message} onRetry={rooms.reload} /> : rooms.data && rooms.data.rooms.length === 0 ? (
            <EmptyState icon={<Users size={28} />} title="No rooms yet">
              {user?.guest ? 'You no longer belong to a room. Open an invite link to join, or sign in for a persistent account.' : 'Create a room for your club, office or pub team and share the invite link. Every match played there feeds the room’s leaderboard.'}
            </EmptyState>
          ) : (
            <div className="room-grid">
              {rooms.data?.rooms.map((room) => <RoomCard room={room} key={room.id} guest={user?.guest} />)}
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
            <p className="muted-note">You can play and score in your room. Guests aren’t ranked and don’t have a personal stats profile.</p>
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
                <p className="muted-note">Finish a match in a room to start building your stats.</p>
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
                {stats.data.recentMatches.slice(0, 5).map((match) => <MatchRow match={match} roomName={match.roomName} key={match.id} highlightUserId={user?.id} />)}
              </div>
            </section>
          )}
          </>}
        </aside>
      </div>

      {creating && <CreateRoomDialog onClose={() => setCreating(false)} />}
      {joining && <JoinRoomDialog onClose={() => setJoining(false)} />}
    </div>
  )
}

function RoomCard({ room, guest = false }: { room: RoomSummary; guest?: boolean }) {
  return (
    <Link to={`/rooms/${room.id}`} className="room-card">
      <div className="room-card-top">
        <strong>{room.name}</strong>
        {room.liveMatches > 0 && <span className="live-pill"><Radio size={11} /> {room.liveMatches} LIVE</span>}
      </div>
      <div className="room-card-members">
        <AvatarStack users={room.members} />
        <span>{room.memberCount} {room.memberCount === 1 ? 'member' : 'members'}</span>
      </div>
      <div className="room-card-stats">
        <span><small>YOUR RATING</small><b>{guest ? 'Unranked' : formatRating(room.myRating)}</b></span>
        <span><small>RANK</small><b>{!guest && room.myRank ? `#${room.myRank}` : '—'}</b></span>
        <span><small>MATCHES</small><b>{room.completedMatches}</b></span>
      </div>
      <small className="room-card-foot"><Trophy size={11} /> {guest ? 'Guest' : room.role === 'owner' ? 'You host this room' : 'Member'} · active {relativeTime(room.lastActivityAt)}</small>
    </Link>
  )
}

function CreateRoomDialog({ onClose }: { onClose: () => void }) {
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
      const { room } = await api.createRoom(name.trim())
      navigate(`/rooms/${room.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <Sheet title="New room" eyebrow="CREATE A ROOM" onClose={onClose} labelledBy="create-room-title">
      <form className="sheet-form" onSubmit={submit}>
        <label className="field">
          <span>Room name</span>
          <input autoFocus value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="e.g. Friday Oche Club" />
        </label>
        <p className="field-hint">You’ll get an invite link to share once the room is created.</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="sheet-actions">
          <button type="button" className="ghost-button" onClick={onClose}>CANCEL</button>
          <button className="primary-button" disabled={busy || !name.trim()}>CREATE ROOM</button>
        </div>
      </form>
    </Sheet>
  )
}

function JoinRoomDialog({ onClose }: { onClose: () => void }) {
  const { navigate } = useRouter()
  const [value, setValue] = useState('')
  const code = inviteCodeFrom(value)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (code) navigate(`/join/${code}`)
  }

  return (
    <Sheet title="Join a room" eyebrow="INVITE LINK OR CODE" onClose={onClose} labelledBy="join-room-title">
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
