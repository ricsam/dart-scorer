import type { SSEStreamingApi } from 'hono/streaming'

/** Channels a client can subscribe to over server-sent events. */
export type Channel =
  | { kind: 'match'; matchId: string; leagueId: string | null; lobbyId: string | null }
  | { kind: 'league'; leagueId: string }
  | { kind: 'lobby'; lobbyId: string }
  /** Personal notifications such as lobby invites. */
  | { kind: 'user' }

/** Events queued beyond this for one slow client close its stream (it reconnects and resyncs). */
const MAX_PENDING_WRITES = 64

/** One open SSE stream. Writes are serialized; `done` resolves when the stream should end. */
export class Subscription {
  readonly userId: string
  readonly channel: Channel
  readonly done: Promise<void>
  private readonly stream: SSEStreamingApi
  private resolveDone!: () => void
  private queue: Promise<void> = Promise.resolve()
  private pending = 0
  private closedFlag = false
  /** Ending after queued writes: later events are dropped without access checks. */
  private retiring = false

  constructor(userId: string, channel: Channel, stream: SSEStreamingApi, readonly sessionHash: string, private readonly authorized: () => boolean) {
    this.userId = userId
    this.channel = channel
    this.stream = stream
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve
    })
  }

  get closed() {
    return this.closedFlag || this.retiring
  }

  private enqueue(write: () => Promise<unknown>, force = false) {
    if (this.closedFlag || (this.retiring && !force)) return
    if (!force && !this.checkAccess()) return
    if (this.pending >= MAX_PENDING_WRITES) {
      this.close()
      return
    }
    this.pending += 1
    this.queue = this.queue
      .then(async () => {
        if ((force ? !this.closedFlag : this.checkAccess()) && !this.stream.aborted) await write()
      })
      .catch(() => {})
      .finally(() => {
        this.pending -= 1
      })
  }

  /** `force` delivers a final event (such as "you were removed") after access has already ended. */
  send(event: string, data: unknown, options: { force?: boolean } = {}) {
    const payload = JSON.stringify(data)
    this.enqueue(() => this.stream.writeSSE({ event, data: payload }), options.force)
  }

  /** Raw SSE text such as `retry:` fields or `: comments`. */
  raw(text: string) {
    this.enqueue(() => this.stream.write(text))
  }

  /** Waits for queued writes to flush (used before ending a stream deliberately). */
  flushed() {
    return this.queue
  }

  /** Ends the stream once already-queued writes (such as a final forced event) are delivered. */
  retire() {
    if (this.closedFlag || this.retiring) return
    this.retiring = true
    void this.queue.then(() => this.close())
  }

  checkAccess() {
    if (this.closedFlag) return false
    if (!this.authorized()) {
      this.close()
      return false
    }
    return true
  }

  close() {
    if (this.closedFlag) return
    this.closedFlag = true
    this.stream.abort() // discard queued writes immediately on revocation
    this.resolveDone()
  }
}

/** In-memory registry of open streams; this server runs as a single process. */
export class LiveHub {
  private readonly subscriptions = new Set<Subscription>()
  private readonly connections = new Map<string, number>()
  /** Users whose last stream closed recently: still shown online while they navigate between pages. */
  private readonly leaving = new Map<string, ReturnType<typeof setTimeout>>()
  private shuttingDown = false
  /** Called when a user comes online or goes offline (after `offlineGraceMs`). */
  onPresence: ((userId: string) => void) | null = null

  constructor(private readonly offlineGraceMs = 5000) {}

  get size() {
    return this.subscriptions.size
  }

  get closing() {
    return this.shuttingDown
  }

  countForUser(userId: string) {
    return this.connections.get(userId) ?? 0
  }

  /** True while the user has Oche open in at least one tab (any live stream). */
  isOnline(userId: string) {
    return this.countForUser(userId) > 0 || this.leaving.has(userId)
  }

  add(subscription: Subscription) {
    if (this.shuttingDown) {
      subscription.close()
      return
    }
    this.subscriptions.add(subscription)
    const { userId } = subscription
    const before = this.countForUser(userId)
    this.connections.set(userId, before + 1)
    const pending = this.leaving.get(userId)
    if (pending) {
      clearTimeout(pending)
      this.leaving.delete(userId)
    } else if (before === 0) {
      this.onPresence?.(userId)
    }
    void subscription.done.then(() => this.forget(subscription))
  }

  remove(subscription: Subscription) {
    subscription.close()
    this.forget(subscription)
  }

  private forget(subscription: Subscription) {
    if (!this.subscriptions.delete(subscription)) return
    const { userId } = subscription
    const remaining = this.countForUser(userId) - 1
    if (remaining > 0) {
      this.connections.set(userId, remaining)
      return
    }
    this.connections.delete(userId)
    if (this.shuttingDown) return
    const timer = setTimeout(() => {
      this.leaving.delete(userId)
      if (!this.shuttingDown && this.countForUser(userId) === 0) this.onPresence?.(userId)
    }, this.offlineGraceMs)
    timer.unref?.()
    this.leaving.set(userId, timer)
  }

  private open(predicate: (subscription: Subscription) => boolean) {
    return [...this.subscriptions].filter((subscription) => !subscription.closed && predicate(subscription))
  }

  matchSubscribers(matchId: string) {
    return this.open(({ channel }) => channel.kind === 'match' && channel.matchId === matchId)
  }

  leagueSubscribers(leagueId: string) {
    return this.open(({ channel }) => channel.kind === 'league' && channel.leagueId === leagueId)
  }

  /** Lobby page streams. */
  lobbySubscribers(lobbyId: string) {
    return this.open(({ channel }) => channel.kind === 'lobby' && channel.lobbyId === lobbyId)
  }

  /** Streams watching any match started from a lobby (they share its chat). */
  lobbyMatchSubscribers(lobbyId: string) {
    return this.open(({ channel }) => channel.kind === 'match' && channel.lobbyId === lobbyId)
  }

  userSubscribers(userId: string) {
    return this.open((subscription) => subscription.channel.kind === 'user' && subscription.userId === userId)
  }

  /** Ends every stream (league and match channels) in a league, optionally only one user's. */
  closeLeague(leagueId: string, userId?: string) {
    for (const subscription of this.subscriptions) {
      const { channel } = subscription
      if (!('leagueId' in channel) || channel.leagueId !== leagueId) continue
      if (userId !== undefined && subscription.userId !== userId) continue
      subscription.close()
    }
  }

  /** Ends lobby page streams after their final event has been written. */
  closeLobby(lobbyId: string, userId?: string) {
    for (const subscription of this.lobbySubscribers(lobbyId)) {
      if (userId !== undefined && subscription.userId !== userId) continue
      subscription.retire()
    }
  }

  closeMatch(matchId: string) {
    for (const subscription of this.matchSubscribers(matchId)) subscription.retire()
  }

  closeSession(hash: string) {
    for (const subscription of this.subscriptions) {
      if (subscription.sessionHash === hash) subscription.close()
    }
  }

  closeAll() {
    this.shuttingDown = true
    for (const timer of this.leaving.values()) clearTimeout(timer)
    this.leaving.clear()
    for (const subscription of this.subscriptions) subscription.close()
    this.subscriptions.clear()
    this.connections.clear()
  }
}
