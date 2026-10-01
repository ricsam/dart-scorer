import { evaluateOnlineEntry, gameReducer } from '../src/game'
import { getBot } from '../src/shared/bots'
import { botDart } from './bot-darts'
import type { Services } from './context'
import { nowIso } from './context'
import { loadMatchView, type MatchView } from './data'
import { publishMatch } from './events'
import { MAX_STATE_BYTES } from './match-limits'

export const BOT_DART_DELAY_MS = 850

/** One server-owned timer per match, never per viewer. The database remains authoritative. */
export class BotRunner {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private stopped = false

  constructor(private services: () => Services, private random: () => number = Math.random) {}

  private activeBot(view: MatchView | undefined) {
    if (!view || view.row.status !== 'live' || view.state.winner !== null || view.state.matchWinner !== null) return undefined
    const id = view.players[view.state.active]?.botId
    return id ? getBot(id) : undefined
  }

  /** Replaces a pending throw after any human correction, resetting its grace period. */
  schedule(matchId: string) {
    this.cancel(matchId)
    const { db } = this.services()
    if (this.stopped || !db.raw.isOpen) return
    const view = loadMatchView(db, matchId)
    if (!this.activeBot(view)) return
    const version = view!.row.version
    const timer = setTimeout(() => {
      this.timers.delete(matchId)
      this.throwDart(matchId, version)
    }, BOT_DART_DELAY_MS)
    timer.unref()
    this.timers.set(matchId, timer)
  }

  private throwDart(matchId: string, expectedVersion: number) {
    const services = this.services()
    const { db, logger } = services
    if (this.stopped || !db.raw.isOpen) return
    try {
      const view = loadMatchView(db, matchId)
      const bot = this.activeBot(view)
      if (!view || !bot) return
      if (view.row.version !== expectedVersion) {
        this.schedule(matchId)
        return
      }
      const entry = botDart(view.state, bot, this.random)
      if (evaluateOnlineEntry(entry, view.state.currentVisit.length).error) throw new Error('Invalid bot dart')
      const next = gameReducer(view.state, { type: 'submit', entry })
      if (next === view.state) return
      const state = JSON.stringify(next)
      if (state.length > MAX_STATE_BYTES) return
      const result = db.run(
        "UPDATE matches SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND status = 'live'",
        state, nowIso(services), matchId, expectedVersion,
      )
      if (result.changes) publishMatch(services, matchId) // also schedules the next dart, if needed
    } catch {
      // Never log game state or account data. Do not retry an uncertain write.
      logger.error('Unable to advance a bot turn.')
    }
  }

  /** Recover interrupted bot turns after a process restart, including partial visits. */
  resume() {
    const { db } = this.services()
    for (const row of db.all<{ id: string }>(
      "SELECT id FROM matches WHERE status = 'live' AND EXISTS (SELECT 1 FROM match_players p WHERE p.match_id = matches.id AND p.bot_id IS NOT NULL)",
    )) this.schedule(row.id)
  }

  cancel(matchId: string) {
    const timer = this.timers.get(matchId)
    if (timer) clearTimeout(timer)
    this.timers.delete(matchId)
  }

  stop() {
    this.stopped = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}
