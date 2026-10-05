import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { MatchEvent, LeagueEvent } from '../../src/shared/api'
import { CONTENT_SECURITY_POLICY } from '../../server/security'
import { act, CHECKOUT_101, Client, createMatch, createLeague, devLogin, finish, joinLeague, play, setup } from './helpers'

type Frame = { event?: string; data?: string; retry?: string; comments: string[] }

/** Minimal SSE parser over a fetch Response body. */
class SseReader {
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

  cancel() {
    return this.reader.cancel()
  }
}

describe('live match events', () => {
  it('sends retry and the current match, then updates with per-viewer permissions', async () => {
    const ctx = setup()
    const owner = await devLogin(ctx.app, 'Olivia')
    const max = await devLogin(ctx.app, 'Max')
    const nora = await devLogin(ctx.app, 'Nora')
    const league = await createLeague(owner)
    await joinLeague(max, league.inviteCode)
    await joinLeague(nora, league.inviteCode)
    const match = await createMatch(max, league.id, [{ userId: max.userId! }, { guestName: 'Guest' }])

    const maxStream = new SseReader(await max.get(`/api/matches/${match.id}/events`))
    const first = await maxStream.next()
    expect(first?.retry).toBe('3000')
    const initial = await maxStream.nextEvent<MatchEvent>('match')
    expect(initial.match).toMatchObject({ id: match.id, version: 1, canScore: true, canDelete: true })

    const noraStream = new SseReader(await nora.get(`/api/matches/${match.id}/events`))
    expect((await noraStream.nextEvent<MatchEvent>('match')).match).toMatchObject({ canScore: false, canDelete: false })

    await act(max, match, { type: 'submit', entry: 'T20' })
    const update = await maxStream.nextEvent<MatchEvent>('match')
    expect(update.match.version).toBe(2)
    expect(update.match.state.players[0].score).toBe(41)
    expect(update.match.canScore).toBe(true)
    const noraUpdate = await noraStream.nextEvent<MatchEvent>('match')
    expect(noraUpdate.match.version).toBe(2)
    expect(noraUpdate.match.canScore).toBe(false)

    expect(ctx.app.services.hub.size).toBe(2)
    await maxStream.cancel()
    await noraStream.cancel()
    await vi.waitFor(() => expect(ctx.app.services.hub.size).toBe(0))
  })

  it('rejects outsiders and caps concurrent streams per user', async () => {
    const ctx = setup({ limits: { streamsPerUser: 2 } })
    const owner = await devLogin(ctx.app, 'Olivia')
    const outsider = await devLogin(ctx.app, 'Otto')
    const league = await createLeague(owner)
    const match = await createMatch(owner, league.id, [{ userId: owner.userId! }, { guestName: 'Guest' }])

    expect(await outsider.json('GET', `/api/matches/${match.id}/events`, 404)).toMatchObject({ error: 'not_found' })
    expect(await outsider.json('GET', `/api/leagues/${league.id}/events`, 404)).toMatchObject({ error: 'not_found' })
    await new Client(ctx.app).json('GET', `/api/leagues/${league.id}/events`, 401)

    const a = new SseReader(await owner.get(`/api/matches/${match.id}/events`))
    const b = new SseReader(await owner.get(`/api/leagues/${league.id}/events`))
    expect(await owner.json('GET', `/api/leagues/${league.id}/events`, 429)).toMatchObject({ error: 'rate_limited' })
    await a.cancel()
    await vi.waitFor(() => expect(ctx.app.services.hub.countForUser(owner.userId!)).toBe(1))
    const c = new SseReader(await owner.get(`/api/leagues/${league.id}/events`))
    await b.cancel()
    await c.cancel()
  })

  it('sends heartbeats and closes streams on shutdown', async () => {
    const ctx = setup({ limits: { heartbeatMs: 20 } })
    const owner = await devLogin(ctx.app, 'Olivia')
    const league = await createLeague(owner)
    const stream = new SseReader(await owner.get(`/api/leagues/${league.id}/events`))
    await stream.nextEvent<LeagueEvent>('league')
    let frame = await stream.next()
    while (frame && frame.comments.length === 0) frame = await stream.next()
    expect(frame?.comments).toEqual(['heartbeat'])

    ctx.app.services.hub.closeAll()
    let ended = false
    for (let i = 0; i < 20 && !ended; i += 1) ended = (await stream.next()) === null
    expect(ended).toBe(true)
    expect(ctx.app.services.hub.size).toBe(0)
  })
})

describe('live league events', () => {
  it('publishes match changes, deletions, refreshes and ends removed members’ streams', async () => {
    const ctx = setup()
    const owner = await devLogin(ctx.app, 'Olivia')
    const max = await devLogin(ctx.app, 'Max')
    const league = await createLeague(owner)
    await joinLeague(max, league.inviteCode)

    const ownerStream = new SseReader(await owner.get(`/api/leagues/${league.id}/events`))
    expect(await ownerStream.nextEvent<LeagueEvent>('league')).toEqual({ type: 'refresh' })
    const maxStream = new SseReader(await max.get(`/api/leagues/${league.id}/events`))
    expect(await maxStream.nextEvent<LeagueEvent>('league')).toEqual({ type: 'refresh' })

    const match = await createMatch(max, league.id, [{ userId: max.userId! }, { userId: owner.userId! }])
    const created = await ownerStream.nextEvent<LeagueEvent>('league')
    expect(created).toMatchObject({ type: 'match', match: { id: match.id, status: 'live', active: 0 } })

    const won = await play(max, match, CHECKOUT_101)
    expect(await ownerStream.nextEvent<LeagueEvent>('league')).toMatchObject({ type: 'match', match: { awaitingConfirmation: true } })
    await finish(max, won)
    expect(await ownerStream.nextEvent<LeagueEvent>('league')).toMatchObject({ type: 'match', match: { status: 'completed' } })

    await owner.json('PATCH', `/api/leagues/${league.id}`, 200, { name: 'Renamed' })
    expect(await ownerStream.nextEvent<LeagueEvent>('league')).toEqual({ type: 'refresh' })

    const matchStream = new SseReader(await max.get(`/api/matches/${match.id}/events`))
    await matchStream.nextEvent<MatchEvent>('match')
    await owner.json('DELETE', `/api/matches/${match.id}`, 204)
    expect(await ownerStream.nextEvent<LeagueEvent>('league')).toEqual({ type: 'match-deleted', matchId: match.id })
    expect(await matchStream.nextEvent<{ matchId: string }>('match-deleted')).toEqual({ matchId: match.id })
    expect(await matchStream.next()).toBeNull()

    // Max's league stream: skip events until the removal ends it.
    await owner.json('DELETE', `/api/leagues/${league.id}/members/${max.userId}`, 204)
    let frame = await maxStream.next()
    while (frame) frame = await maxStream.next()
    expect(frame).toBeNull()
    expect(await ownerStream.nextEvent<LeagueEvent>('league')).toEqual({ type: 'refresh' })
    await ownerStream.cancel()
  })
})

describe('static web app', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oche-static-test-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Oche</title>')
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log("oche")')
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('serves assets immutably and falls back to index.html for client routes', async () => {
    const ctx = setup({ config: { staticDir: dir } })
    const client = new Client(ctx.app)

    const index = await client.get('/')
    expect(index.status).toBe(200)
    expect(await index.text()).toContain('<title>Oche</title>')
    expect(index.headers.get('cache-control')).toBe('no-cache')
    expect(index.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY)

    const route = await client.get('/leagues/abc/leaderboard')
    expect(route.status).toBe(200)
    expect(route.headers.get('content-type')).toContain('text/html')
    expect(route.headers.get('cache-control')).toBe('no-cache')
    expect(route.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY)
    expect(route.headers.get('x-frame-options')).toBe('DENY')

    const asset = await client.get('/assets/app-abc123.js')
    expect(asset.status).toBe(200)
    expect(await asset.text()).toBe('console.log("oche")')
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(asset.headers.get('content-security-policy')).toBeNull()

    expect((await client.get('/favicon.svg')).headers.get('cache-control')).toBe('public, max-age=3600')
    expect((await client.get('/assets/missing.js')).status).toBe(404)

    const api = await client.get('/api/nothing-here')
    expect(api.status).toBe(404)
    expect(await api.json()).toMatchObject({ error: 'not_found' })
    expect((await client.get('/auth/nothing-here')).status).toBe(404)
    expect(await (await client.get('/healthz')).text()).toBe('ok')
    expect((await client.post('/some/page', {})).status).toBe(404)
  })

  it('does nothing when STATIC_DIR is missing', async () => {
    const ctx = setup({ config: { staticDir: join(dir, 'does-not-exist') } })
    expect((await new Client(ctx.app).get('/')).status).toBe(404)
  })
})
