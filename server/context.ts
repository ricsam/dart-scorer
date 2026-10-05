import type { BotRunner } from './bots'
import type { Janitor } from './janitor'
import type { Config } from './config'
import type { Db } from './db'
import type { GoogleClient } from './google'
import type { LiveHub } from './live'
import type { RateLimiter } from './security'

export type Clock = () => Date

export type Logger = {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export type Limits = {
  /** Requests to /auth/* per client IP per minute. */
  authPerMinute: number
  /** Mutating /api requests per signed-in user per minute. */
  mutationsPerMinute: number
  /** Concurrent SSE streams per user. */
  streamsPerUser: number
  /** Interval between SSE heartbeat comments (Cloudflare drops streams idle for 100 s). */
  heartbeatMs: number
  /** Chat messages per user per minute. */
  chatPerMinute: number
}

export const DEFAULT_LIMITS: Limits = {
  authPerMinute: 30,
  mutationsPerMinute: 300,
  streamsPerUser: 20,
  heartbeatMs: 25_000,
  chatPerMinute: 20,
}

export type UserRow = {
  id: string
  is_guest: number
  claimed: number
  guest_league_id: string | null
  guest_name_key: string | null
  google_sub: string
  email: string
  name: string
  avatar_url: string | null
  created_at: string
  last_login_at: string
  /** Last lobby format and seat count, reused for the next lobby (JSON). */
  play_settings?: string | null
}

/** Everything a route needs, resolved once per app. */
export type Services = {
  db: Db
  config: Config
  google: GoogleClient | null
  now: Clock
  logger: Logger
  hub: LiveHub
  bots: BotRunner
  janitor: Janitor
  limits: Limits
  authLimiter: RateLimiter
  mutationLimiter: RateLimiter
  /** Chat messages per user per minute. */
  chatLimiter: RateLimiter
}

export type AppEnv = {
  Variables: {
    user: UserRow | null
    sessionHash: string | null
  }
}

export const nowIso = (services: Pick<Services, 'now'>) => services.now().toISOString()
