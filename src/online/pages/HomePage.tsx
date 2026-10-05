import { Bot, Globe2, Play, Radio, Target, Trophy, UserPlus, Users } from 'lucide-react'
import type { MatchSummary } from '../../shared/api'
import { api } from '../api'
import { formatAverage, formatPercent, matchContextLabel, shortFormat } from '../format'
import { useDocumentTitle, useResource } from '../hooks'
import { Link } from '../router'
import { useNotifications } from '../notifications'
import { useSession } from '../session'
import { Avatar, AvatarStack, Loading, StatTile } from '../ui'
import { MatchRow } from './components/MatchRow'
import { LeaguesPanel } from './LeaguesPage'
import './lobby/lobby.css'

export function HomePage() {
  useDocumentTitle('Oche — darts online')
  const { user } = useSession()
  if (user?.guest) return <GuestHome name={user.name} />
  return <PlayerHome />
}

function PlayerHome() {
  const { user } = useSession()
  const { invites, accept, decline } = useNotifications()
  const stats = useResource(`me-stats:${user?.id}`, () => api.myStats())
  const live = useResource(`me-live:${user?.id}`, () => api.myLiveMatches())
  const lobby = useResource(`me-lobby:${user?.id}`, () => api.currentLobby())
  const current = lobby.data?.lobby ?? null
  const liveMatches = live.data?.matches ?? []
  const recent = stats.data
    ? [...stats.data.recentMatches, ...stats.data.training.recentMatches].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')).slice(0, 5)
    : []
  const all = stats.data?.all.totals

  return (
    <div className="page home-page">
      <section className="play-hero">
        <div>
          <span className="eyebrow">WELCOME BACK, {user?.name.toUpperCase()}</span>
          <h1>Ready for the oche?</h1>
          <p>Practise solo and watch your average climb, take on a house bot, settle it with friends, or test yourself in ranked games on the global stage.</p>
        </div>
        <div className="play-hero-actions">
          <Link className="primary-button play-button" to="/play"><Play size={18} /> PLAY</Link>
          {current && <span className="muted-note">You’re in {current.role === 'leader' ? 'your lobby' : `${current.leader.name}’s lobby`} · {current.seats.length} {current.seats.length === 1 ? 'player' : 'players'}</span>}
        </div>
      </section>

      <nav className="play-modes" aria-label="Ways to play">
        <Link className="play-mode" to="/play"><Target size={20} /><b>Solo practice</b><small>Play legs on your own and track your 3-dart average.</small></Link>
        <Link className="play-mode" to="/play?bot=1"><Bot size={20} /><b>Play a bot</b><small>Six house rivals, from novice to pro level.</small></Link>
        <Link className="play-mode" to="/play?invite=1"><UserPlus size={20} /><b>Invite friends</b><small>Private lobby with chat. Everyone scores on their own phone.</small></Link>
        <Link className="play-mode" to="/global"><Globe2 size={20} /><b>Global stage</b><small>Join open lobbies and climb the ranked table.</small></Link>
      </nav>

      {invites.length > 0 && (
        <section className="panel" aria-labelledby="invites-heading">
          <div className="panel-head"><h2 id="invites-heading">Invitations</h2><span className="panel-count">{invites.length}</span></div>
          <div className="continue-list">
            {invites.map((invite) => (
              <div className="lobby-card" key={invite.lobby.id}>
                <span className="lobby-card-copy">
                  <b><Avatar user={invite.invitedBy} size={22} /> {invite.invitedBy.name} invited you {invite.lobby.ranked && <span className="lobby-badge ranked"><Trophy size={9} /> RANKED</span>}</b>
                  <small>{shortFormat(invite.lobby.settings)} · {invite.lobby.seats.length}/{invite.lobby.capacity} players</small>
                </span>
                <span className="page-actions">
                  <button className="ghost-button" onClick={() => void decline(invite)}>DECLINE</button>
                  <button className="primary-button" onClick={() => void accept(invite)}>JOIN</button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {(current || liveMatches.length > 0) && (
        <section className="panel" aria-labelledby="continue-heading">
          <div className="panel-head"><h2 id="continue-heading">Continue</h2></div>
          <div className="continue-list">
            {current && (
              <Link className="lobby-card" to={`/lobbies/${current.id}`}>
                <span className="lobby-card-copy">
                  <b>{current.role === 'leader' ? 'Your lobby' : `${current.leader.name}’s lobby`} <span className="lobby-badges"><span className="lobby-badge">{current.visibility === 'public' ? 'PUBLIC' : 'PRIVATE'}</span>{current.ranked && <span className="lobby-badge ranked">RANKED</span>}{current.match && <span className="lobby-badge"><Radio size={9} /> IN GAME</span>}</span></b>
                  <small>{shortFormat(current.settings)}</small>
                  <span className="lobby-card-seats"><AvatarStack users={current.seats.map((seat) => ({ id: seat.userId ?? seat.id, name: seat.name, avatarUrl: seat.avatarUrl }))} size={20} /> {current.seats.length}/{current.capacity}</span>
                </span>
                <span className="live-card-cta">OPEN →</span>
              </Link>
            )}
            {liveMatches.map((match) => <ContinueMatch key={match.id} match={match} />)}
          </div>
        </section>
      )}

      <div className="home-grid">
        <LeaguesPanel limit={4} />
        <aside className="home-side">
          <section className="panel" aria-labelledby="career-heading">
            <div className="panel-head">
              <h2 id="career-heading">Your numbers</h2>
              <Link to="/me" className="text-link">ALL STATS →</Link>
            </div>
            {stats.loading && !stats.data ? <Loading /> : stats.data && all ? (
              all.matches === 0 ? (
                <p className="muted-note">Play a game to start building your stats. Solo practice counts too.</p>
              ) : (
                <div className="stat-grid compact">
                  <StatTile label="3-DART AVG" value={formatAverage(all.average)} hint={`${all.matches} ${all.matches === 1 ? 'game' : 'games'}`} />
                  <StatTile label="CHECKOUT" value={formatPercent(all.checkoutRate)} />
                  <StatTile label="GLOBAL RATING" value={stats.data.global.rating} hint={stats.data.global.rank ? `#${stats.data.global.rank} · ${stats.data.global.wins}–${stats.data.global.losses}` : 'No ranked games yet'} />
                  <StatTile label="WIN RATE" value={formatPercent(stats.data.totals.winRate)} hint={stats.data.totals.matches ? `${stats.data.totals.wins}–${stats.data.totals.losses} vs people` : 'No matches vs people yet'} />
                  <StatTile label="180S" value={all.scores180} />
                  <StatTile label="HIGH OUT" value={all.highestCheckout || '—'} />
                </div>
              )
            ) : null}
          </section>
          {recent.length > 0 && (
            <section className="panel" aria-labelledby="recent-heading">
              <div className="panel-head"><h2 id="recent-heading">Recent games</h2></div>
              <div className="match-list">
                {recent.map((match) => <MatchRow match={match} leagueName={match.leagueName} key={match.id} highlightUserId={user?.id} />)}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

function ContinueMatch({ match }: { match: MatchSummary & { leagueName: string | null } }) {
  return (
    <Link className="lobby-card" to={`/matches/${match.id}`}>
      <span className="lobby-card-copy">
        <b><span className="live-pill"><Radio size={11} /> {match.awaitingConfirmation ? 'RESULT PENDING' : 'LIVE'}</span> {matchContextLabel(match, match.leagueName)}</b>
        <small>{shortFormat(match.settings)}</small>
        <span className="lobby-live-score">{match.players.map((player) => <span key={player.slot} className={match.active === player.slot ? 'at-oche' : ''}><b>{player.name}</b><em>{player.legs}</em><strong>{player.score}</strong></span>)}</span>
      </span>
      <span className="live-card-cta">RESUME →</span>
    </Link>
  )
}

function GuestHome({ name }: { name: string }) {
  return (
    <div className="page home-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">PLAYING AS A GUEST</span>
          <h1>{name}</h1>
        </div>
      </div>
      <div className="home-grid">
        <LeaguesPanel guest />
        <aside className="home-side">
          <section className="panel guest-info">
            <h2>No account needed to play</h2>
            <p className="muted-note">You can play and score in your league. Guests aren’t ranked and don’t have a personal stats profile.</p>
            <p className="muted-note">Keep using this browser to return as the same guest. Signing out or clearing cookies loses access to this identity.</p>
            <p className="muted-note"><Users size={12} /> Lobbies, ranked games and the global stage need a Google account.</p>
            <Link className="text-link" to="/login">SIGN IN FOR AN ACCOUNT →</Link>
          </section>
        </aside>
      </div>
    </div>
  )
}
