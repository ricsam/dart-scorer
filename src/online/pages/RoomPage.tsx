import { useCallback, useState } from 'react'
import { Pencil, Play, Radio, Share2, Trophy, Users } from 'lucide-react'
import type { MatchSummary, RoomDetail, RoomEvent } from '../../shared/api'
import { api } from '../api'
import { formatAverage } from '../format'
import { useDocumentTitle, useEventStream, useResource } from '../hooks'
import { Link } from '../router'
import { Avatar, AvatarStack, ErrorState, Loading } from '../ui'
import { InviteDialog } from './room/InviteDialog'
import { Leaderboard } from './room/Leaderboard'
import { MatchHistory } from './room/MatchHistory'
import { Members, RenameRoomDialog } from './room/Members'
import { NewMatchDialog } from './room/NewMatchDialog'

type Tab = 'leaderboard' | 'matches' | 'members'

function upsertMatch(room: RoomDetail, match: MatchSummary): RoomDetail {
  const liveMatches = room.liveMatches.filter((item) => item.id !== match.id)
  const recentMatches = room.recentMatches.filter((item) => item.id !== match.id)
  if (match.status === 'live') liveMatches.unshift(match)
  else recentMatches.unshift(match)
  return { ...room, liveMatches, recentMatches: recentMatches.slice(0, 10) }
}

export function RoomPage({ roomId }: { roomId: string }) {
  const room = useResource(`room:${roomId}`, () => api.room(roomId))
  const [tab, setTab] = useState<Tab>('leaderboard')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [newMatchOpen, setNewMatchOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [statsVersion, setStatsVersion] = useState(0)
  const detail = room.data?.room
  useDocumentTitle(detail ? `${detail.name} — Oche` : 'Room — Oche')

  const { reload, setData } = room
  const onEvent = useCallback((event: RoomEvent) => {
    if (event.type === 'refresh') {
      void reload()
      setStatsVersion((value) => value + 1)
    } else if (event.type === 'match') {
      setData((current) => current ? { room: upsertMatch(current.room, event.match) } : current)
      if (event.match.status === 'completed') setStatsVersion((value) => value + 1)
    } else if (event.type === 'match-deleted') {
      setData((current) => current ? {
        room: {
          ...current.room,
          liveMatches: current.room.liveMatches.filter((item) => item.id !== event.matchId),
          recentMatches: current.room.recentMatches.filter((item) => item.id !== event.matchId),
        },
      } : current)
      setStatsVersion((value) => value + 1)
    }
  }, [reload, setData])
  const stream = useEventStream<RoomEvent>(detail && !room.error ? `/api/rooms/${encodeURIComponent(roomId)}/events` : null, 'room', onEvent, () => { void reload() })

  if (room.loading && !detail) return <Loading />
  if (room.error) {
    return room.error.status === 404
      ? <ErrorState message="This room doesn’t exist or you are no longer a member." />
      : <ErrorState message={room.error.message} onRetry={room.reload} />
  }
  if (!detail) return null

  return (
    <div className="page room-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <Link to="/" className="crumb">ROOMS</Link> / {detail.role === 'owner' ? 'YOUR ROOM' : `HOSTED BY ${detail.owner.name.toUpperCase()}`}
            {stream === 'open' && <span className="stream-dot" title="Live updates connected" />}
          </span>
          <h1 className="room-title">
            {detail.name}
            {detail.role === 'owner' && <button className="inline-icon" onClick={() => setRenameOpen(true)} aria-label="Rename room"><Pencil size={15} /></button>}
          </h1>
          <div className="room-meta">
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
          <span><b>Invite your crew.</b> Share the invite link so friends can join this room — or start a match right away with guest players.</span>
          <button className="ghost-button" onClick={() => setInviteOpen(true)}>SHARE INVITE</button>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Room sections">
        <button role="tab" aria-selected={tab === 'leaderboard'} className={tab === 'leaderboard' ? 'active' : ''} onClick={() => setTab('leaderboard')}><Trophy size={15} /> LEADERBOARD</button>
        <button role="tab" aria-selected={tab === 'matches'} className={tab === 'matches' ? 'active' : ''} onClick={() => setTab('matches')}>MATCHES</button>
        <button role="tab" aria-selected={tab === 'members'} className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>MEMBERS <span className="tab-count">{detail.members.length}</span></button>
      </div>

      {tab === 'leaderboard' && <Leaderboard room={detail} refreshKey={statsVersion} />}
      {tab === 'matches' && <MatchHistory room={detail} refreshKey={statsVersion} />}
      {tab === 'members' && <Members room={detail} onChanged={room.reload} onInvite={() => setInviteOpen(true)} onRename={() => setRenameOpen(true)} />}

      {inviteOpen && <InviteDialog room={detail} onClose={() => setInviteOpen(false)} onRegenerated={(inviteCode) => room.setData((current) => current ? { room: { ...current.room, inviteCode } } : current)} />}
      {newMatchOpen && <NewMatchDialog room={detail} onClose={() => setNewMatchOpen(false)} />}
      {renameOpen && <RenameRoomDialog room={detail} onClose={() => setRenameOpen(false)} onRenamed={(updated) => room.setData({ room: updated })} />}
    </div>
  )
}

function LiveMatchCard({ match }: { match: MatchSummary }) {
  return (
    <Link to={`/matches/${match.id}`} className="live-card">
      <div className="live-card-head">
        <span className="live-pill"><Radio size={11} /> {match.awaitingConfirmation ? 'RESULT PENDING' : 'LIVE'}</span>
        <small>{match.settings.game} · FIRST TO {match.settings.legsToWin}</small>
      </div>
      <div className="live-card-players">
        {match.players.map((player) => (
          <div key={player.slot} className={match.active === player.slot && !match.awaitingConfirmation ? 'at-oche' : ''}>
            <Avatar user={{ id: player.userId ?? `guest-${player.slot}`, name: player.name, avatarUrl: player.avatarUrl }} size={24} />
            <span><b>{player.name}</b><small>AVG {formatAverage(player.average)}</small></span>
            <em>{player.legs}</em>
            <strong>{player.score}</strong>
          </div>
        ))}
      </div>
      <span className="live-card-cta">WATCH OR SCORE →</span>
    </Link>
  )
}
