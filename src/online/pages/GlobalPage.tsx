import { useEffect, useState } from 'react'
import { Eye, Globe2, Plus, Radio, Trophy, UserPlus } from 'lucide-react'
import type { LobbySummary, RankingEntry } from '../../shared/api'
import { api, errorMessage } from '../api'
import { formatAverage, formatPercent, relativeTime, shortFormat } from '../format'
import { useDocumentTitle, useResource } from '../hooks'
import { Link, useRouter } from '../router'
import { useSession } from '../session'
import { Avatar, AvatarStack, EmptyState, ErrorState, Loading, Segmented } from '../ui'
import { BotAvatar } from '../BotAvatar'
import './lobby/lobby.css'

const PROVISIONAL = 5

/** Public lobbies to join, public games to watch and the global rankings. */
export function GlobalPage() {
  useDocumentTitle('Global stage — Oche')
  const { user } = useSession()
  const { navigate } = useRouter()
  const [tick, setTick] = useState(0)
  const [filter, setFilter] = useState<'all' | 'ranked'>('all')
  const lobbies = useResource(`public-lobbies:${tick}`, api.lobbies)
  const live = useResource(`public-matches:${tick}`, api.publicMatches)
  const rankings = useResource('rankings', api.rankings)
  const [joining, setJoining] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Lobbies come and go quickly: refresh while the page is visible.
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') setTick((value) => value + 1) }, 6000)
    return () => window.clearInterval(timer)
  }, [])

  const join = async (lobby: LobbySummary) => {
    setJoining(lobby.id)
    setError(null)
    try {
      await api.joinLobby(lobby.id)
      navigate(`/lobbies/${lobby.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
      setJoining(null)
      setTick((value) => value + 1)
    }
  }

  const listed = (lobbies.data?.lobbies ?? []).filter((lobby) => filter === 'all' || lobby.ranked)
  const me = rankings.data?.me ?? null

  return (
    <div className="page global-page">
      <section className="play-hero">
        <div>
          <span className="eyebrow"><Globe2 size={12} /> THE GLOBAL STAGE</span>
          <h1>Challenge anyone</h1>
          <p>Join an open lobby, or open yours to everyone. Ranked games between accounts update your global rating; casual games just count in your stats.</p>
        </div>
        <div className="play-hero-actions">
          <Link className="primary-button play-button" to="/play?public=1"><Plus size={16} /> OPEN A PUBLIC LOBBY</Link>
          <span className="muted-note">{me ? `You are #${me.rank} of ${rankings.data?.totalPlayers} · rating ${me.rating}` : 'Play a ranked game to get on the board.'}</span>
        </div>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="global-grid">
        <section className="panel" aria-labelledby="open-lobbies-title">
          <div className="panel-head">
            <h2 id="open-lobbies-title">Open lobbies</h2>
            <Segmented label="Lobby filter" value={filter} options={[{ value: 'all', label: 'ALL' }, { value: 'ranked', label: 'RANKED' }]} onChange={setFilter} />
          </div>
          {lobbies.loading && !lobbies.data ? <Loading /> : lobbies.error ? <ErrorState message={lobbies.error.message} onRetry={lobbies.reload} /> : listed.length === 0 ? (
            <EmptyState icon={<Globe2 size={26} />} title="No open lobbies right now">
              Open a public lobby and anyone can take a seat. It stays listed while you are online.
            </EmptyState>
          ) : (
            <div className="continue-list">
              {listed.map((lobby) => (
                <div className="lobby-card" key={lobby.id}>
                  <span className="lobby-card-copy">
                    <b><Avatar user={lobby.leader} size={22} /> {lobby.leader.name} <small>{lobby.leader.rating}</small> <span className="lobby-badges">{lobby.ranked ? <span className="lobby-badge ranked"><Trophy size={9} /> RANKED</span> : <span className="lobby-badge">CASUAL</span>}{lobby.playing && <span className="lobby-badge"><Radio size={9} /> IN GAME</span>}</span></b>
                    <small>{shortFormat(lobby.settings)}</small>
                    <span className="lobby-card-seats"><AvatarStack users={lobby.seats.map((seat) => ({ id: seat.userId ?? seat.name, name: seat.name, avatarUrl: seat.avatarUrl }))} size={20} /> {lobby.seats.length}/{lobby.capacity} players</span>
                  </span>
                  {lobby.seats.some((seat) => seat.userId === user?.id)
                    ? <Link className="ghost-button" to={`/lobbies/${lobby.id}`}>OPEN</Link>
                    : <button className="primary-button" disabled={joining !== null} onClick={() => void join(lobby)}><UserPlus size={14} /> {joining === lobby.id ? 'JOINING…' : 'JOIN'}</button>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="live-games-title">
          <div className="panel-head"><h2 id="live-games-title">Live now</h2><span className="panel-sub">Public games you can watch</span></div>
          {live.loading && !live.data ? <Loading /> : live.error ? <ErrorState message={live.error.message} onRetry={live.reload} /> : live.data && live.data.matches.length === 0 ? (
            <EmptyState icon={<Eye size={26} />} title="Nobody on the oche">Public games appear here while they are played.</EmptyState>
          ) : (
            <div className="continue-list">
              {live.data?.matches.map((match) => (
                <Link className="lobby-card" key={match.id} to={`/matches/${match.id}`}>
                  <span className="lobby-card-copy">
                    <b>{match.ranked ? <span className="lobby-badge ranked"><Trophy size={9} /> RANKED</span> : <span className="lobby-badge">CASUAL</span>} {shortFormat(match.settings)}</b>
                    <span className="lobby-live-score">{match.players.map((player) => <span key={player.slot} className={match.active === player.slot ? 'at-oche' : ''}>{player.botId ? <BotAvatar botId={player.botId} size={16} /> : <Avatar user={{ id: player.userId ?? `guest-${player.slot}`, name: player.name, avatarUrl: player.avatarUrl }} size={16} />}<b>{player.name}</b><em>{player.legs}</em><strong>{player.score}</strong></span>)}</span>
                  </span>
                  <span className="live-card-cta"><Eye size={13} /> WATCH</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel" aria-labelledby="rankings-title">
        <div className="panel-head"><h2 id="rankings-title"><Trophy size={18} className="title-icon" /> Global rankings</h2><span className="panel-sub">Ranked lobby games · Elo from 1000</span></div>
        {rankings.loading && !rankings.data ? <Loading /> : rankings.error ? <ErrorState message={rankings.error.message} onRetry={rankings.reload} /> : rankings.data && rankings.data.entries.length === 0 ? (
          <EmptyState icon={<Trophy size={26} />} title="The board is empty">Win a ranked game to take the first spot.</EmptyState>
        ) : rankings.data && (
          <>
            <RankingsTable entries={rankings.data.entries} meId={user?.id} />
            {me && !rankings.data.entries.some((entry) => entry.id === me.id) && <RankingsTable entries={[me]} meId={user?.id} caption="Your position" />}
            <p className="table-footnote">Players with fewer than {PROVISIONAL} ranked games are provisional. Ratings use the same Elo as leagues (K = 32). <Link to="/about#ratings">How ratings work</Link></p>
          </>
        )}
      </section>
    </div>
  )
}

function RankingsTable({ entries, meId, caption }: { entries: RankingEntry[]; meId?: string; caption?: string }) {
  return (
    <div className="table-scroll">
      <table className="leaderboard-table rankings-table">
        {caption && <caption className="section-label">{caption}</caption>}
        <thead>
          <tr><th className="rank-col">#</th><th className="player-col">PLAYER</th><th>RATING</th><th>GAMES</th><th>W–L</th><th>WIN %</th><th>AVG</th><th>LAST PLAYED</th></tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className={entry.id === meId ? 'me' : ''}>
              <td className="rank-col"><span className={`rank rank-${entry.rank}`}>{entry.rank}</span></td>
              <td className="player-col"><span className="player-cell"><Avatar user={entry} size={26} /><span><b>{entry.name}{entry.id === meId && ' (you)'}</b></span></span></td>
              <td>{entry.rating}{entry.matches < PROVISIONAL && <span className="provisional" title="Fewer than five ranked games">NEW</span>}</td>
              <td>{entry.matches}</td>
              <td>{entry.wins}–{entry.losses}</td>
              <td>{formatPercent(entry.matches ? entry.wins / entry.matches : null)}</td>
              <td>{formatAverage(entry.average)}</td>
              <td>{entry.lastPlayedAt ? relativeTime(entry.lastPlayedAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
