import { Radio } from 'lucide-react'
import type { MatchSummary } from '../../../shared/api'
import { formatAverage, relativeTime, shortFormat } from '../../format'
import { Link } from '../../router'
import { Avatar } from '../../ui'

/** Compact match line used in room histories, profiles and the home page. */
export function MatchRow({ match, roomName, highlightUserId }: { match: MatchSummary; roomName?: string; highlightUserId?: string }) {
  const live = match.status === 'live'
  const me = highlightUserId ? match.players.find((player) => player.userId === highlightUserId) : undefined
  const outcome = !live && me ? (me.won ? 'win' : 'loss') : null
  return (
    <Link to={`/matches/${match.id}`} className={`match-row ${live ? 'live' : ''}`}>
      <div className="match-row-players">
        {match.players.map((player) => (
          <span key={player.slot} className={`${player.won ? 'winner' : ''} ${match.active === player.slot && live ? 'at-oche' : ''}`}>
            <Avatar user={{ id: player.userId ?? `guest-${player.slot}`, name: player.name, avatarUrl: player.avatarUrl }} size={20} />
            <b>{player.name}</b>
            <em>{player.legs}</em>
            <small>{formatAverage(player.average)}</small>
          </span>
        ))}
      </div>
      <div className="match-row-meta">
        {live ? (
          <span className="live-pill"><Radio size={11} /> {match.awaitingConfirmation ? 'RESULT PENDING' : 'LIVE'}</span>
        ) : outcome ? <span className={`outcome ${outcome}`}>{outcome === 'win' ? 'WON' : 'LOST'}</span> : null}
        <small>{roomName ? `${roomName} · ` : ''}{shortFormat(match.settings)}</small>
        <small>{relativeTime(match.completedAt ?? match.updatedAt)}</small>
      </div>
    </Link>
  )
}
