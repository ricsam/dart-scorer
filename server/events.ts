import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { MatchEvent, RoomEvent } from '../src/shared/api'
import type { Services } from './context'
import { loadMatchView, matchDetail, matchSummary } from './data'
import { rateLimited } from './http'
import { Subscription, type Channel } from './live'

/**
 * Opens an SSE stream: `retry`, an initial event, then whatever the hub publishes on the channel,
 * with heartbeat comments so proxies (Cloudflare drops idle streams at 100 s) keep it open.
 */
export function openEventStream(c: Context, services: Services, userId: string, channel: Channel, initial: { event: string; data: unknown }) {
  const { hub, limits } = services
  if (hub.closing) return c.json({ error: 'server_error', message: 'Server is shutting down.' }, 503)
  if (hub.countForUser(userId) >= limits.streamsPerUser) throw rateLimited('Too many open live connections.')
  c.header('X-Accel-Buffering', 'no')
  return streamSSE(c, async (stream) => {
    // Runs synchronously up to the first await, so the subscription is counted before we return.
    const sessionHash = c.get('sessionHash') as string
    const subscription = new Subscription(userId, channel, stream, sessionHash, () => !!services.db.get(
      `SELECT 1 FROM sessions s JOIN room_members m ON m.user_id = s.user_id
       WHERE s.token_hash = ? AND s.user_id = ? AND s.expires_at > ? AND m.room_id = ?`,
      sessionHash, userId, services.now().toISOString(), channel.roomId,
    ))
    hub.add(subscription)
    stream.onAbort(() => subscription.close())
    c.req.raw.signal?.addEventListener?.('abort', () => subscription.close(), { once: true })
    subscription.raw('retry: 3000\n\n')
    subscription.send(initial.event, initial.data)
    const heartbeat = setInterval(() => subscription.raw(': heartbeat\n\n'), limits.heartbeatMs)
    try {
      await subscription.done
    } finally {
      clearInterval(heartbeat)
      hub.remove(subscription)
    }
  })
}

/** Pushes the current match to its viewers (per-viewer permissions) and its summary to the room. */
export function publishMatch(services: Services, matchId: string) {
  services.bots.schedule(matchId)
  const { db, hub } = services
  const view = loadMatchView(db, matchId)
  if (!view) return
  for (const subscription of hub.matchSubscribers(matchId)) {
    const event: MatchEvent = { match: matchDetail(view, subscription.userId) }
    subscription.send('match', event)
  }
  const roomSubscribers = hub.roomSubscribers(view.row.room_id)
  if (roomSubscribers.length) {
    const event: RoomEvent = { type: 'match', match: matchSummary(view) }
    for (const subscription of roomSubscribers) subscription.send('room', event)
  }
}

/** Tells room viewers a match is gone and ends streams watching it (they reconnect into a 404). */
export function publishMatchDeleted(services: Services, matchId: string, roomId: string) {
  services.bots.cancel(matchId)
  const { hub } = services
  for (const subscription of hub.matchSubscribers(matchId)) subscription.send('match-deleted', { matchId })
  hub.closeMatch(matchId)
  const event: RoomEvent = { type: 'match-deleted', matchId }
  for (const subscription of hub.roomSubscribers(roomId)) subscription.send('room', event)
}

export function publishRoomRefresh(services: Services, roomId: string) {
  const event: RoomEvent = { type: 'refresh' }
  for (const subscription of services.hub.roomSubscribers(roomId)) subscription.send('room', event)
}
