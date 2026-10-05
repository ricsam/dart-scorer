import { expect } from 'vitest'
import { createApp, type App, type AppDeps } from '../../server/app'
import type { Config } from '../../server/config'
import type { Limits } from '../../server/context'
import { openDatabase, type Db } from '../../server/db'
import type { GoogleClient, GoogleIdentity } from '../../server/google'
import type { LobbyDetail, LobbyOptionsRequest, MatchDetail, MatchSettings } from '../../src/shared/api'

export type Frame = { event?: string; data?: string; retry?: string; comments: string[] }

/** Minimal SSE parser over a fetch Response body. */
export class SseReader {
  private buffer = ''
  private readonly decoder = new TextDecoder()
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>

  constructor(response: Response) {
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    this.reader = response.body!.getReader()
  }

  /** Next frame, or null when the stream ends. */
  async next(timeoutMs = 2000): Promise<Frame | null> {
    for (;;) {
      const end = this.buffer.indexOf('\n\n')
      if (end !== -1) {
        const raw = this.buffer.slice(0, end)
        this.buffer = this.buffer.slice(end + 2)
        const frame: Frame = { comments: [] }
        for (const line of raw.split('\n')) {
          if (line.startsWith(':')) frame.comments.push(line.slice(1).trim())
          else if (line.startsWith('event: ')) frame.event = line.slice(7)
          else if (line.startsWith('data: ')) frame.data = frame.data === undefined ? line.slice(6) : `${frame.data}\n${line.slice(6)}`
          else if (line.startsWith('retry: ')) frame.retry = line.slice(7)
        }
        return frame
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const chunk = await Promise.race([
        this.reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out waiting for an SSE frame')), timeoutMs)
        }),
      ]).finally(() => clearTimeout(timer))
      if (chunk.done) return null
      this.buffer += this.decoder.decode(chunk.value, { stream: true })
    }
  }

  /** Next frame with an `event:` (skipping retry/heartbeat frames). */
  async nextEvent<T>(name: string): Promise<T> {
    for (;;) {
      const frame = await this.next()
      if (!frame) throw new Error('stream ended')
      if (frame.event === undefined) continue
      expect(frame.event).toBe(name)
      return JSON.parse(frame.data!) as T
    }
  }

  /** Skips frames until an event named `name` satisfies `predicate`. */
  async waitFor<T>(name: string, predicate: (data: T) => boolean = () => true): Promise<T> {
    for (;;) {
      const frame = await this.next()
      if (!frame) throw new Error(`stream ended before a matching ${name} event`)
      if (frame.event !== name) continue
      const data = JSON.parse(frame.data!) as T
      if (predicate(data)) return data
    }
  }

  /** Every event name until the stream goes quiet (or ends). */
  async drain(timeoutMs = 150) {
    const names: string[] = []
    for (;;) {
      let frame: Frame | null
      try { frame = await this.next(timeoutMs) } catch { return names }
      if (!frame) return names
      if (frame.event) names.push(frame.event)
    }
  }

  cancel() {
    return this.reader.cancel()
  }
}

export const ORIGIN = 'http://localhost:5173'

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    host: '127.0.0.1',
    production: false,
    publicUrl: ORIGIN,
    publicOrigin: ORIGIN,
    secure: false,
    databasePath: ':memory:',
    staticDir: null,
    google: { clientId: 'test-client-id', clientSecret: 'test-client-secret' },
    devLogin: true,
    trustProxy: false,
    ...overrides,
  }
}

/** Google stand-in: returns `identity` (with the nonce Google would echo back) for any code. */
export class FakeGoogle implements GoogleClient {
  identity: Partial<GoogleIdentity> = {}
  /** Overrides the nonce returned; by default the nonce from the last authorization URL is echoed. */
  nonceOverride: string | null | undefined = undefined
  lastNonce: string | null = null
  fail = false
  calls: { code: string; codeVerifier: string; redirectUri: string }[] = []

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<GoogleIdentity> {
    this.calls.push(input)
    if (this.fail) throw new Error('token exchange failed')
    return {
      sub: 'google-sub-1',
      email: 'alex@example.com',
      emailVerified: true,
      name: 'Alex Example',
      givenName: 'Alex',
      picture: 'https://lh3.googleusercontent.com/a/alex',
      nonce: this.nonceOverride !== undefined ? this.nonceOverride : this.lastNonce,
      ...this.identity,
    }
  }
}

export class Clock {
  time: number
  constructor(start = '2026-03-01T12:00:00.000Z') {
    this.time = Date.parse(start)
  }
  now = () => new Date(this.time)
  advance(ms: number) {
    this.time += ms
  }
  advanceDays(days: number) {
    this.advance(days * 24 * 60 * 60 * 1000)
  }
}

export const DAY = 24 * 60 * 60 * 1000

export type TestContext = {
  app: App
  db: Db
  clock: Clock
  google: FakeGoogle
  config: Config
}

export function setup(options: { config?: Partial<Config>; limits?: Partial<Limits>; deps?: Partial<AppDeps> } = {}): TestContext {
  const db = openDatabase(':memory:')
  const clock = new Clock()
  const google = new FakeGoogle()
  const config = testConfig(options.config)
  const silent = { info: () => {}, warn: () => {}, error: () => {} }
  const app = createApp({
    db,
    config,
    google,
    now: clock.now,
    logger: silent,
    limits: { authPerMinute: 10_000, mutationsPerMinute: 10_000, ...options.limits },
    ...options.deps,
  })
  return { app, db, clock, google, config }
}

type RequestOptions = { body?: unknown; headers?: Record<string, string>; rawBody?: string }

/** A browser-like client with a cookie jar that talks to the app in-process. */
export class Client {
  readonly app: App
  cookies = new Map<string, string>()
  origin: string | null = ORIGIN
  userId: string | null = null

  constructor(app: App) {
    this.app = app
  }

  cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  storeCookies(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(';')
      const index = pair.indexOf('=')
      const name = pair.slice(0, index).trim()
      const value = pair.slice(index + 1).trim()
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute))
      if (expired || value === '') this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  async request(method: string, path: string, options: RequestOptions = {}) {
    const headers: Record<string, string> = { ...options.headers }
    if (this.cookies.size) headers.cookie = this.cookieHeader()
    if (this.origin && method !== 'GET' && method !== 'HEAD' && !('origin' in headers)) headers.origin = this.origin
    let body: string | undefined
    if (options.rawBody !== undefined) body = options.rawBody
    else if (options.body !== undefined) {
      body = JSON.stringify(options.body)
      if (!('content-type' in headers)) headers['content-type'] = 'application/json'
    }
    const response = await this.app.request(path, { method, headers, body })
    this.storeCookies(response)
    return response
  }

  get(path: string, options?: RequestOptions) {
    return this.request('GET', path, options)
  }

  post(path: string, body?: unknown, options?: RequestOptions) {
    return this.request('POST', path, { ...options, body })
  }

  patch(path: string, body?: unknown, options?: RequestOptions) {
    return this.request('PATCH', path, { ...options, body })
  }

  delete(path: string, options?: RequestOptions) {
    return this.request('DELETE', path, options)
  }

  /** Performs a request and asserts the status, returning the parsed JSON body. */
  // Test callers may inspect arbitrary error bodies without declaring every negative-case shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async json<T = any>(method: string, path: string, status: number, body?: unknown): Promise<T> {
    const response = await this.request(method, path, { body })
    const text = await response.text()
    if (response.status !== status) throw new Error(`${method} ${path}: expected ${status}, got ${response.status}: ${text}`)
    return (text ? JSON.parse(text) : null) as T
  }
}

export async function devLogin(app: App, name: string, email = `${name.toLowerCase()}@example.com`) {
  const client = new Client(app)
  const user = await client.json<{ user: { id: string } }>('POST', '/auth/dev-login', 200, { name, email })
  client.userId = user.user.id
  return client
}

export const DEFAULTS_101: MatchSettings = { game: 101, doubleIn: false, doubleOut: true, legsToWin: 1 }

export async function createLeague(client: Client, name = 'Tuesday League') {
  const { league } = await client.json<{ league: { id: string; inviteCode: string } }>('POST', '/api/leagues', 201, { name })
  return league
}

export async function joinLeague(client: Client, inviteCode: string) {
  return client.json<{ leagueId: string }>('POST', `/api/invites/${inviteCode}/join`, 200)
}

export async function createMatch(client: Client, leagueId: string, players: ({ userId: string } | { guestName: string })[], settings: MatchSettings = DEFAULTS_101) {
  const { match } = await client.json<{ match: MatchDetail }>('POST', `/api/leagues/${leagueId}/matches`, 201, { players, settings })
  return match
}

export async function act(client: Client, match: MatchDetail, action: unknown, status = 200) {
  const result = await client.json<{ match: MatchDetail }>('POST', `/api/matches/${match.id}/actions`, status, { action, baseVersion: match.version })
  return result.match
}

/** Submits visits in order (strings are dart entries, objects are actions). */
export async function play(client: Client, match: MatchDetail, ...steps: (string | { type: string })[]) {
  let current = match
  for (const step of steps) current = await act(client, current, typeof step === 'string' ? { type: 'submit', entry: step } : step)
  return current
}

export async function finish(client: Client, match: MatchDetail, status = 200) {
  const result = await client.json<{ match: MatchDetail }>('POST', `/api/matches/${match.id}/finish`, status, { baseVersion: match.version })
  return result.match
}

/** 101 double-out checkout in one visit: 60 + 9 + 32. */
export const CHECKOUT_101 = 'T20 9 D16'

/** Creates a lobby (default: private, unranked 101 first-to-1) led by `client`. */
export async function createLobby(client: Client, options: LobbyOptionsRequest = {}) {
  const { lobby } = await client.json<{ lobby: LobbyDetail }>('POST', '/api/lobbies', 201, { settings: DEFAULTS_101, ...options })
  return lobby
}

export async function joinLobby(client: Client, lobby: Pick<LobbyDetail, 'id'>, code?: string | null, status = 200) {
  return (await client.json<{ lobby: LobbyDetail }>('POST', `/api/lobbies/${lobby.id}/join`, status, code ? { code } : {})).lobby
}

export async function startLobby(client: Client, lobby: Pick<LobbyDetail, 'id'>) {
  const { matchId } = await client.json<{ matchId: string }>('POST', `/api/lobbies/${lobby.id}/start`, 201)
  return (await client.json<{ match: MatchDetail }>('GET', `/api/matches/${matchId}`, 200)).match
}

export async function current(client: Client, matchId: string) {
  return (await client.json<{ match: MatchDetail }>('GET', `/api/matches/${matchId}`, 200)).match
}
