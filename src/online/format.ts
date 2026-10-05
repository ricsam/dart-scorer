import type { MatchContext, MatchSettings } from '../shared/api'

/** Where a match counts: a league's table, the global ranking, practice or a casual lobby game. */
export function matchContextLabel(match: MatchContext & { players: { length: number } }, leagueName?: string | null) {
  if (match.leagueId) return leagueName ?? 'League'
  if (match.practice) return match.players.length === 1 ? 'Solo practice' : 'Bot practice'
  return match.ranked ? 'Ranked' : 'Lobby game'
}

/** "1:05" style countdown; never negative. */
export function formatCountdown(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export const formatAverage = (value: number | null | undefined) => value === null || value === undefined || Number.isNaN(value) ? '—' : value.toFixed(1)

export const formatPercent = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined || Number.isNaN(value) ? '—' : `${(value * 100).toFixed(digits)}%`

export const formatRating = (value: number) => Math.round(value).toString()

export function formatDelta(value: number | null | undefined) {
  if (value === null || value === undefined) return ''
  const rounded = Math.round(value)
  if (rounded === 0) return '±0'
  return rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`
}

export const formatCount = (value: number | null | undefined) => value === null || value === undefined ? '—' : String(value)

export const formatBestLeg = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${value}`

export function rulesLabel(settings: Pick<MatchSettings, 'doubleIn' | 'doubleOut'>) {
  return `${settings.doubleIn ? 'DOUBLE IN' : 'SINGLE IN'} · ${settings.doubleOut ? 'DOUBLE OUT' : 'SINGLE OUT'}`
}

export function shortFormat(settings: MatchSettings) {
  const rules = [settings.doubleIn ? 'DI' : null, settings.doubleOut ? 'DO' : 'SO'].filter(Boolean).join('/')
  return `${settings.game} · ${rules} · FIRST TO ${settings.legsToWin}`
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

export const formatDate = (iso: string) => dateFormat.format(new Date(iso))
export const formatDateTime = (iso: string) => `${dateFormat.format(new Date(iso))}, ${timeFormat.format(new Date(iso))}`

export function relativeTime(iso: string, now = Date.now()) {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return formatDate(iso)
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`).toUpperCase()
}

export function hueFor(value: string) {
  let hash = 0
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

/** Only same-origin relative paths are allowed as post-sign-in destinations. */
export function safeReturnTo(value: string | null) {
  if (!value || value.length > 1024 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /\s/.test(value)) return '/'
  const url = new URL(value, 'https://oche.invalid')
  return url.origin === 'https://oche.invalid' && !/^\/(login|auth)(\/|$)/.test(url.pathname) ? url.pathname + url.search + url.hash : '/'
}

/** Accepts a full invite link or a bare invite code. */
export function inviteCodeFrom(value: string) {
  const trimmed = value.trim()
  const fromLink = trimmed.match(/\/join\/([A-Za-z0-9_-]+)/)
  if (fromLink) return fromLink[1]
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null
}
