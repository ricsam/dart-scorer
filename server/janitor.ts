import type { Services } from './context'
import { buildMatchView, type MatchRow } from './data'
import { publishLobbyClosed } from './events'
import { lobbySeats, liveLobbyMatch, type LobbyRow } from './lobby-data'
import { AUTO_SAVE_AFTER_MS, INVITE_TTL_MS, LOBBY_IDLE_MS } from './match-limits'
import { saveMatchResult } from './results'

export const JANITOR_INTERVAL_MS = 30_000

/**
 * Periodic housekeeping for online play: saves decided lobby matches nobody confirmed, expires
 * invites and closes lobbies nobody uses. Idempotent; the database remains authoritative.
 */
export class Janitor {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly services: () => Services) {}

  start(intervalMs = JANITOR_INTERVAL_MS) {
    if (this.timer) return
    this.timer = setInterval(() => this.sweep(), intervalMs)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  sweep() {
    const services = this.services()
    const { db, logger } = services
    if (!db.raw.isOpen) return
    const now = services.now().getTime()
    const before = (ms: number) => new Date(now - ms).toISOString()

    for (const row of db.all<MatchRow>(
      "SELECT * FROM matches WHERE status = 'live' AND visibility <> 'league' AND updated_at <= ? ORDER BY updated_at LIMIT 100",
      before(AUTO_SAVE_AFTER_MS),
    )) {
      try {
        const view = buildMatchView(db, row)
        if (view.state.matchWinner !== null) saveMatchResult(services, view, { reason: 'auto' })
      } catch {
        // Never log game state or account data. A concurrent save simply wins.
        logger.warn('Unable to save a decided lobby match automatically.')
      }
    }

    db.run('DELETE FROM lobby_invites WHERE created_at <= ?', before(INVITE_TTL_MS))

    for (const lobby of db.all<LobbyRow>('SELECT * FROM lobbies WHERE updated_at <= ? ORDER BY updated_at LIMIT 200', before(LOBBY_IDLE_MS))) {
      if (liveLobbyMatch(db, lobby.id)) continue
      if (lobbySeats(db, lobby.id).some((seat) => seat.user_id && services.hub.isOnline(seat.user_id))) continue
      db.run('DELETE FROM lobbies WHERE id = ?', lobby.id)
      publishLobbyClosed(services, lobby.id)
    }
  }
}
