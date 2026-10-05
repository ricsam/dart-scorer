import type { SSEStreamingApi } from 'hono/streaming'

/** Channels a client can subscribe to over server-sent events. */
export type Channel =
  | { kind: 'match'; matchId: string; leagueId: string }
  | { kind: 'league'; leagueId: string }

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

  constructor(userId: string, channel: Channel, stream: SSEStreamingApi, readonly sessionHash: string, private readonly authorized: () => boolean) {
    this.userId = userId
    this.channel = channel
    this.stream = stream
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve
    })
  }

  get closed() {
    return this.closedFlag
  }

  private enqueue(write: () => Promise<unknown>) {
    if (!this.checkAccess()) return
    if (this.pending >= MAX_PENDING_WRITES) {
      this.close()
      return
    }
    this.pending += 1
    this.queue = this.queue
      .then(async () => {
        if (this.checkAccess() && !this.stream.aborted) await write()
      })
      .catch(() => {})
      .finally(() => {
        this.pending -= 1
      })
  }

  send(event: string, data: unknown) {
    const payload = JSON.stringify(data)
    this.enqueue(() => this.stream.writeSSE({ event, data: payload }))
  }

  /** Raw SSE text such as `retry:` fields or `: comments`. */
  raw(text: string) {
    this.enqueue(() => this.stream.write(text))
  }

  /** Waits for queued writes to flush (used before ending a stream deliberately). */
  flushed() {
    return this.queue
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
  private shuttingDown = false

  get size() {
    return this.subscriptions.size
  }

  get closing() {
    return this.shuttingDown
  }

  countForUser(userId: string) {
    let count = 0
    for (const subscription of this.subscriptions) if (subscription.userId === userId) count += 1
    return count
  }

  add(subscription: Subscription) {
    if (this.shuttingDown) {
      subscription.close()
      return
    }
    this.subscriptions.add(subscription)
    void subscription.done.then(() => this.subscriptions.delete(subscription))
  }

  remove(subscription: Subscription) {
    subscription.close()
    this.subscriptions.delete(subscription)
  }

  matchSubscribers(matchId: string) {
    return [...this.subscriptions].filter((s) => s.channel.kind === 'match' && s.channel.matchId === matchId && !s.closed)
  }

  leagueSubscribers(leagueId: string) {
    return [...this.subscriptions].filter((s) => s.channel.kind === 'league' && s.channel.leagueId === leagueId && !s.closed)
  }

  /** Ends every stream (league and match channels) in a league, optionally only one user's. */
  closeLeague(leagueId: string, userId?: string) {
    for (const subscription of this.subscriptions) {
      if (subscription.channel.leagueId !== leagueId) continue
      if (userId !== undefined && subscription.userId !== userId) continue
      subscription.close()
    }
  }

  closeMatch(matchId: string) {
    for (const subscription of this.matchSubscribers(matchId)) void subscription.flushed().then(() => subscription.close())
  }

  closeSession(hash: string) {
    for (const subscription of this.subscriptions) {
      if (subscription.sessionHash === hash) subscription.close()
    }
  }

  closeAll() {
    this.shuttingDown = true
    for (const subscription of this.subscriptions) subscription.close()
    this.subscriptions.clear()
  }
}
