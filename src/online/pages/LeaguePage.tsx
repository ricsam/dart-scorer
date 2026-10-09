import { useCallback, useState } from 'react'
import { Pencil, Play, Radio, Share2, Trophy, Users } from 'lucide-react'
import type { MatchSummary, LeagueDetail, LeagueEvent } from '../../shared/api'
import { api } from '../api'
import { BotAvatar, BotBadge } from '../BotAvatar'
import { formatAverage } from '../format'
import { useDocumentTitle, useEventStream, useResource } from '../hooks'
import { Link } from '../router'
import { Avatar, AvatarStack, ErrorState, Loading } from '../ui'
import { InviteDialog } from './league/InviteDialog'
import { Leaderboard } from './league/Leaderboard'
import { MatchHistory } from './league/MatchHistory'
import { Members, RenameLeagueDialog } from './league/Members'
import { NewMatchDialog } from './league/NewMatchDialog'

type Tab = 'leaderboard' | 'matches' | 'members'

function upsertMatch(league: LeagueDetail, match: MatchSummary): LeagueDetail {
  const liveMatches = league.liveMatches.filter((item) => item.id !== match.id)
  const recentMatches = league.recentMatches.filter((item) => item.id !== match.id)
  if (match.status === 'live') liveMatches.unshift(match)
  else recentMatches.unshift(match)
  return { ...league, liveMatches, recentMatches: recentMatches.slice(0, 10) }
}

export function LeaguePage({ leagueId }: { leagueId: string }) {
  const league = useResource(`league:${leagueId}`, () => api.league(leagueId))
  const [tab, setTab] = useState<Tab>('leaderboard')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [newMatchOpen, setNewMatchOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [statsVersion, setStatsVersion] = useState(0)
  const detail = league.data?.league
  useDocumentTitle(detail ? `${detail.name} — Oche` : 'League — Oche')

  const { reload, setData } = league
  const onEvent = useCallback((event: LeagueEvent) => {
    if (event.type === 'refresh') {
      void reload()
      setStatsVersion((value) => value + 1)
    } else if (event.type === 'match') {
      setData((current) => current ? { league: upsertMatch(current.league, event.match) } : current)
      if (event.match.status === 'completed') setStatsVersion((value) => value + 1)
    } else if (event.type === 'match-deleted') {
      setData((current) => current ? {
        league: {
          ...current.league,
          liveMatches: current.league.liveMatches.filter((item) => item.id !== event.matchId),
          recentMatches: current.league.recentMatches.filter((item) => item.id !== event.matchId),
        },
      } : current)
      setStatsVersion((value) => value + 1)
    }
  }, [reload, setData])
  const stream = useEventStream<LeagueEvent>(detail && !league.error ? `/api/leagues/${encodeURIComponent(leagueId)}/events` : null, 'league', onEvent, () => { void reload() })

  if (league.loading && !detail) return <Loading />
  if (league.error) {
    return league.error.status === 404
      ? <ErrorState message="This league doesn’t exist or you are no longer a member." />
      : <ErrorState message={league.error.message} onRetry={league.reload} />
  }
  if (!detail) return null

  return (
    <div className="page league-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <Link to="/leagues" className="crumb">LEAGUES</Link> / {detail.role === 'owner' ? 'YOUR LEAGUE' : detail.role === 'cohost' ? 'YOU CO-HOST THIS LEAGUE' : `HOSTED BY ${detail.owner.name.toUpperCase()}`}
            {stream === 'open' && <span className="stream-dot" title="Live updates connected" />}
          </span>
          <h1 className="league-title">
            {detail.name}
            {(detail.role === 'owner' || detail.role === 'cohost') && <button className="inline-icon" onClick={() => setRenameOpen(true)} aria-label="Rename league"><Pencil size={15} /></button>}
          </h1>
          <div className="league-meta">
            <AvatarStack users={detail.members} max={6} size={22} />
            <span>{detail.members.length} {detail.members.length === 1 ? 'member' : 'members'}</span>
          </div>
        </div>
        <div className="page-actions">
          <button className="ghost-button" onClick={() => setInviteOpen(true)}><Share2 size={16} /> INVITE</button>
          <button className="primary-button" onClick={() => setNewMatchOpen(true)}><Play size={16} /> NEW MATCH</button>
        </div>
      </div>

      {detail.liveMatches.length > 0 && (
        <section className="live-strip" aria-label="Live matches">
          {detail.liveMatches.map((match) => <LiveMatchCard key={match.id} match={match} />)}
        </section>
      )}

      {detail.members.length === 1 && (
        <div className="callout">
          <Users size={18} />
          <span><b>Invite your crew.</b> Share the invite link so friends can join this league — or start a match right away with guests or a house bot.</span>
          <button className="ghost-button" onClick={() => setInviteOpen(true)}>SHARE INVITE</button>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="League sections">
        <button role="tab" aria-selected={tab === 'leaderboard'} className={tab === 'leaderboard' ? 'active' : ''} onClick={() => setTab('leaderboard')}><Trophy size={15} /> LEADERBOARD</button>
        <button role="tab" aria-selected={tab === 'matches'} className={tab === 'matches' ? 'active' : ''} onClick={() => setTab('matches')}>MATCHES</button>
        <button role="tab" aria-selected={tab === 'members'} className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>MEMBERS <span className="tab-count">{detail.members.length}</span></button>
      </div>

      {tab === 'leaderboard' && <Leaderboard league={detail} refreshKey={statsVersion} />}
      {tab === 'matches' && <MatchHistory league={detail} refreshKey={statsVersion} />}
      {tab === 'members' && <Members league={detail} onChanged={league.reload} onInvite={() => setInviteOpen(true)} onRename={() => setRenameOpen(true)} />}

      {inviteOpen && <InviteDialog league={detail} onClose={() => setInviteOpen(false)} onRegenerated={(inviteCode) => league.setData((current) => current ? { league: { ...current.league, inviteCode } } : current)} />}
      {newMatchOpen && <NewMatchDialog league={detail} onClose={() => setNewMatchOpen(false)} />}
      {renameOpen && <RenameLeagueDialog league={detail} onClose={() => setRenameOpen(false)} onRenamed={(updated) => league.setData({ league: updated })} />}
    </div>
  )
}

function LiveMatchCard({ match }: { match: MatchSummary }) {
  return (
    <Link to={`/matches/${match.id}`} className="live-card">
      <div className="live-card-head">
        <span className="live-pill"><Radio size={11} /> {match.awaitingConfirmation ? 'RESULT PENDING' : 'LIVE'}</span>
        <small>{match.players.some((player) => player.botId) && 'TRAINING · '}{match.settings.game} · FIRST TO {match.settings.legsToWin}</small>
      </div>
      <div className="live-card-players">
        {match.players.map((player) => (
          <div key={player.slot} className={match.active === player.slot && !match.awaitingConfirmation ? 'at-oche' : ''}>
            {player.botId ? <BotAvatar botId={player.botId} size={24} /> : <Avatar user={{ id: player.userId ?? `guest-${player.slot}`, name: player.name, avatarUrl: player.avatarUrl }} size={24} />}
            <span><b>{player.name} {player.botId && <BotBadge botId={player.botId} />}</b><small>AVG {formatAverage(player.average)}</small></span>
            <em>{player.legs}</em>
            <strong>{player.score}</strong>
          </div>
        ))}
      </div>
      <span className="live-card-cta">WATCH OR SCORE →</span>
    </Link>
  )
}
