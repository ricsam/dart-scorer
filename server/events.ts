import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { ChatEvent, ChatMessage, LeagueEvent, LobbyEvent, MatchEvent, UserEvent } from '../src/shared/api'
import type { Services } from './context'
import { canViewMatch, loadMatchView, matchDetail, matchSummary, type MatchRow } from './data'
import { rateLimited } from './http'
import { Subscription, type Channel } from './live'
import { lobbyDetail, loadLobby } from './lobby-data'

/** Whether `userId` may still receive events on `channel` (checked before every write). */
function channelAccess(services: Services, userId: string, channel: Channel): () => boolean {
  const { db } = services
  switch (channel.kind) {
    case 'league':
      return () => !!db.get('SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?', channel.leagueId, userId)
    case 'match':
      return () => {
        const match = db.get<MatchRow>('SELECT * FROM matches WHERE id = ?', channel.matchId)
        return !!match && canViewMatch(db, match, userId)
      }
    case 'lobby':
      return () => !!db.get('SELECT 1 FROM lobby_players WHERE lobby_id = ? AND user_id = ?', channel.lobbyId, userId)
    case 'user':
      return () => true
  }
}

/**
 * Opens an SSE stream: `retry`, an initial event, then whatever the hub publishes on the channel,
 * with heartbeat comments so proxies (Cloudflare drops idle streams at 100 s) keep it open.
 */
export function openEventStream(c: Context, services: Services, userId: string, channel: Channel, initial: { event: string; data: unknown }) {
  const { hub, limits } = services
  if (hub.closing) return c.json({ error: 'server_error', message: 'Server is shutting down.' }, 503)
  if (hub.countForUser(userId) >= limits.streamsPerUser) throw rateLimited('Too many open live connections.')
  c.header('X-Accel-Buffering', 'no')
  const allowed = channelAccess(services, userId, channel)
  return streamSSE(c, async (stream) => {
    // Runs synchronously up to the first await, so the subscription is counted before we return.
    const sessionHash = c.get('sessionHash') as string
    const subscription = new Subscription(userId, channel, stream, sessionHash, () => !!services.db.get(
      'SELECT 1 FROM sessions WHERE token_hash = ? AND user_id = ? AND expires_at > ?',
      sessionHash, userId, services.now().toISOString(),
    ) && allowed())
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

/** Sends the current match to its viewers (per-viewer permissions), its league and its lobby. */
export function broadcastMatch(services: Services, matchId: string) {
  const { db, hub } = services
  const view = loadMatchView(db, matchId)
  if (!view) return
  const isOnline = (userId: string) => hub.isOnline(userId)
  for (const subscription of hub.matchSubscribers(matchId)) {
    const event: MatchEvent = { match: matchDetail(view, subscription.userId, isOnline) }
    subscription.send('match', event)
  }
  if (view.row.league_id) {
    const leagueSubscribers = hub.leagueSubscribers(view.row.league_id)
    if (leagueSubscribers.length) {
      const event: LeagueEvent = { type: 'match', match: matchSummary(view) }
      for (const subscription of leagueSubscribers) subscription.send('league', event)
    }
  }
  if (view.row.lobby_id) publishLobby(services, view.row.lobby_id)
}

/** After any accepted change: schedule the next bot dart (if any) and broadcast. */
export function publishMatch(services: Services, matchId: string) {
  services.bots.schedule(matchId)
  broadcastMatch(services, matchId)
}

/** Tells league/lobby viewers a match is gone and ends streams watching it (they reconnect into a 404). */
export function publishMatchDeleted(services: Services, matchId: string, leagueId: string | null, lobbyId: string | null) {
  services.bots.cancel(matchId)
  const { hub } = services
  for (const subscription of hub.matchSubscribers(matchId)) subscription.send('match-deleted', { matchId }, { force: true })
  hub.closeMatch(matchId)
  if (leagueId) {
    const event: LeagueEvent = { type: 'match-deleted', matchId }
    for (const subscription of hub.leagueSubscribers(leagueId)) subscription.send('league', event)
  }
  if (lobbyId) publishLobby(services, lobbyId)
}

export function publishLeagueRefresh(services: Services, leagueId: string) {
  const event: LeagueEvent = { type: 'refresh' }
  for (const subscription of services.hub.leagueSubscribers(leagueId)) subscription.send('league', event)
}

/** Sends each lobby viewer their own view of the lobby (roles differ). */
export function publishLobby(services: Services, lobbyId: string) {
  const { db, hub } = services
  const subscribers = hub.lobbySubscribers(lobbyId)
  if (!subscribers.length) return
  const lobby = loadLobby(db, lobbyId)
  if (!lobby) return
  for (const subscription of subscribers) {
    const event: LobbyEvent = { type: 'lobby', lobby: lobbyDetail(services, lobby, subscription.userId) }
    subscription.send('lobby', event)
  }
}

/** Pulls everyone in the lobby, including players still looking at the previous game, into a new match. */
export function publishLobbyStarted(services: Services, lobbyId: string, matchId: string) {
  const event: LobbyEvent = { type: 'started', matchId }
  const { hub } = services
  for (const subscription of [...hub.lobbySubscribers(lobbyId), ...hub.lobbyMatchSubscribers(lobbyId)]) subscription.send('lobby', event)
  publishLobby(services, lobbyId)
}

/** Final event to a removed player (sent before their access ends), then their lobby streams close. */
export function publishLobbyRemoved(services: Services, lobbyId: string, userId: string) {
  const event: LobbyEvent = { type: 'removed' }
  for (const subscription of services.hub.lobbySubscribers(lobbyId)) {
    if (subscription.userId === userId) subscription.send('lobby', event, { force: true })
  }
  services.hub.closeLobby(lobbyId, userId)
}

export function publishLobbyClosed(services: Services, lobbyId: string) {
  const event: LobbyEvent = { type: 'closed' }
  for (const subscription of services.hub.lobbySubscribers(lobbyId)) subscription.send('lobby', event, { force: true })
  services.hub.closeLobby(lobbyId)
}

/**
 * Delivers a chat message to everyone reading the thread: lobby pages and the lobby's matches
 * (members and players only, never public spectators), or one league match.
 */
export function publishChat(services: Services, thread: { lobbyId: string } | { matchId: string }, message: ChatMessage) {
  const { db, hub } = services
  const event: ChatEvent = { message }
  let subscribers: Subscription[]
  if ('lobbyId' in thread) {
    const readers = new Set(db.all<{ user_id: string }>(
      `SELECT user_id FROM lobby_players WHERE lobby_id = ? AND user_id IS NOT NULL
       UNION SELECT p.user_id FROM match_players p JOIN matches m ON m.id = p.match_id
         WHERE m.lobby_id = ? AND m.status = 'live' AND p.user_id IS NOT NULL`,
      thread.lobbyId, thread.lobbyId,
    ).map((row) => row.user_id))
    subscribers = [...hub.lobbySubscribers(thread.lobbyId), ...hub.lobbyMatchSubscribers(thread.lobbyId)]
      .filter((subscription) => readers.has(subscription.userId))
  } else {
    subscribers = hub.matchSubscribers(thread.matchId)
  }
  for (const subscription of subscribers) subscription.send('chat', event)
}

export function publishUser(services: Services, userId: string, event: UserEvent) {
  for (const subscription of services.hub.userSubscribers(userId)) subscription.send('user', event)
}
