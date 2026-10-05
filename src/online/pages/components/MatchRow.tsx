import { Radio, Trophy } from 'lucide-react'
import type { MatchSummary } from '../../../shared/api'
import { formatAverage, relativeTime, shortFormat } from '../../format'
import { Link } from '../../router'
import { BotAvatar, BotBadge } from '../../BotAvatar'
import { Avatar } from '../../ui'

/** Compact match line used in league histories, profiles, lobbies and the home page. */
export function MatchRow({ match, leagueName, highlightUserId }: { match: MatchSummary; leagueName?: string | null; highlightUserId?: string }) {
  const live = match.status === 'live'
  const me = highlightUserId ? match.players.find((player) => player.userId === highlightUserId) : undefined
  const solo = match.players.length === 1
  const bots = match.players.some((player) => player.botId)
  const outcome = !match.practice && !live && me ? (me.won ? 'win' : 'loss') : null
  const context = match.leagueId ? leagueName : match.ranked ? null : match.practice ? null : 'Lobby game'
  return (
    <Link to={`/matches/${match.id}`} className={`match-row ${live ? 'live' : ''}`}>
      <div className="match-row-players">
        {match.players.map((player) => (
          <span key={player.slot} className={`${player.won && !solo ? 'winner' : ''} ${match.active === player.slot && live ? 'at-oche' : ''}`}>
            {player.botId ? <BotAvatar botId={player.botId} size={20} /> : <Avatar user={{ id: player.userId ?? `guest-${player.slot}`, name: player.name, avatarUrl: player.avatarUrl }} size={20} />}
            <span className="match-row-player-name">
              <b>{player.name}</b>
              {player.botId && <BotBadge botId={player.botId} />}
            </span>
            <em>{player.legs}</em>
            <small>{formatAverage(player.average)}</small>
          </span>
        ))}
      </div>
      <div className="match-row-meta">
        {bots && <span className="bot-badge">BOT MATCH · TRAINING</span>}
        {solo && !bots && <span className="bot-badge">SOLO · TRAINING</span>}
        {match.ranked && <span className="lobby-badge ranked"><Trophy size={9} /> RANKED</span>}
        {live ? (
          <span className="live-pill"><Radio size={11} /> {match.awaitingConfirmation ? 'RESULT PENDING' : 'LIVE'}</span>
        ) : outcome ? <span className={`outcome ${outcome}`}>{outcome === 'win' ? 'WON' : match.forfeitSlot !== null && me?.slot === match.forfeitSlot ? 'CONCEDED' : 'LOST'}</span> : null}
        <small>{context ? `${context} · ` : ''}{solo ? `${match.settings.game} · ${match.settings.legsToWin} ${match.settings.legsToWin === 1 ? 'LEG' : 'LEGS'}` : shortFormat(match.settings)}</small>
        <small>{relativeTime(match.completedAt ?? match.updatedAt)}</small>
      </div>
    </Link>
  )
}
