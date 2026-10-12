import type { CSSProperties } from 'react'
import { getBot } from '../shared/bots'

/** Fictional practice characters, deliberately distinct from league guests. Omit `size` to size it from a stylesheet (`--bot-size`). */
export function BotAvatar({ botId, size, className = '' }: { botId: string; size?: number; className?: string }) {
  const bot = getBot(botId)
  const style = { '--bot-color': bot?.color ?? '#7abca0', ...(size === undefined ? {} : { '--bot-size': `${size}px` }) } as CSSProperties
  return <span className={`bot-avatar ${className}`} style={style} role="img" aria-label={`${bot?.name ?? 'Bot'} · automatic opponent`} title={`${bot?.name ?? 'Bot'} · level ${bot?.difficulty ?? '?'}`}><span aria-hidden="true">{bot?.emoji ?? '🤖'}</span></span>
}

export function BotBadge({ botId }: { botId: string }) {
  const bot = getBot(botId)
  return <small className="bot-badge" title={bot ? `${bot.nickname} · ${bot.level}` : 'Automatic opponent'}>BOT{bot ? ` · ${bot.difficulty}` : ''}</small>
}
