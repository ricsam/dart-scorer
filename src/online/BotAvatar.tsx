import type { CSSProperties } from 'react'
import { getBot } from '../shared/bots'

/** Fictional practice characters, deliberately distinct from league guests. */
export function BotAvatar({ botId, size = 28, className = '' }: { botId: string; size?: number; className?: string }) {
  const bot = getBot(botId)
  return <span className={`bot-avatar ${className}`} style={{ '--bot-color': bot?.color ?? '#7abca0', '--bot-size': `${size}px` } as CSSProperties} role="img" aria-label={`${bot?.name ?? 'Bot'} · automatic opponent`} title={`${bot?.name ?? 'Bot'} · level ${bot?.difficulty ?? '?'}`}><span aria-hidden="true">{bot?.emoji ?? '🤖'}</span></span>
}

export function BotBadge({ botId }: { botId: string }) {
  const bot = getBot(botId)
  return <small className="bot-badge" title={bot ? `${bot.nickname} · ${bot.level}` : 'Automatic opponent'}>BOT{bot ? ` · ${bot.difficulty}` : ''}</small>
}
