import { describe, expect, it } from 'vitest'
import { evaluateOnlineEntry } from '../../src/game'
import { RateLimiter } from '../../server/security'
import { Client, createMatch, createLeague, devLogin, joinLeague, setup } from './helpers'

async function drainInitial(response: Response) {
  const reader = response.body!.getReader()
  let text = ''
  while (!text.includes('event: league')) text += new TextDecoder().decode((await reader.read()).value)
  return reader
}

describe('hardening regressions', () => {
  it('rejects inherited period keys', async () => {
    const { app } = setup()
    const user = await devLogin(app, 'Sam')
    const league = await createLeague(user)
    for (const period of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      await user.json('GET', `/api/leagues/${league.id}/leaderboard?period=${period}`, 400)
    }
  })

  it('rejects impossible darts before changing state or version', async () => {
    const { app } = setup()
    const user = await devLogin(app, 'Sam')
    const league = await createLeague(user)
    const match = await createMatch(user, league.id, [{ userId: user.userId! }, { guestName: 'Guest' }])
    for (const entry of ['501', '999', '61', '41', '59', 'T21', 'banana', '20 20 20 20']) {
      const error = await user.json('POST', `/api/matches/${match.id}/actions`, 400, { baseVersion: 1, action: { type: 'submit', entry } })
      expect(error.message).toBe(evaluateOnlineEntry(entry, 0).error)
      const current = await user.json('GET', `/api/matches/${match.id}`, 200)
      expect(current.match.version).toBe(1)
      expect(current.match.state).toEqual(match.state)
    }
    let result = await user.json('POST', `/api/matches/${match.id}/actions`, 200, { baseVersion: 1, action: { type: 'submit', entry: '36' } })
    expect(result.match.state.players[0].score).toBe(65)
    result = await user.json('POST', `/api/matches/${match.id}/actions`, 200, { baseVersion: 2, action: { type: 'submit', entry: '60' } })
    expect(result.match.state.players[0].score).toBe(5)
  })

  it('logout ends only streams belonging to the revoked session', async () => {
    const { app } = setup()
    const user = await devLogin(app, 'Sam')
    const otherSession = await devLogin(app, 'Sam')
    const league = await createLeague(user)
    const a = await drainInitial(await user.get(`/api/leagues/${league.id}/events`))
    const b = await drainInitial(await otherSession.get(`/api/leagues/${league.id}/events`))
    await user.json('POST', '/auth/logout', 204)
    expect((await a.read()).done).toBe(true)
    expect(app.services.hub.countForUser(otherSession.userId!)).toBe(1)
    await otherSession.json('PATCH', `/api/leagues/${league.id}`, 200, { name: 'Still connected' })
    expect(new TextDecoder().decode((await b.read()).value)).toContain('refresh')
    await b.cancel()
  })

  it.each(['expiry', 'revocation', 'membership'])('heartbeat terminates a stream after %s', async (reason) => {
    const { app, db, clock } = setup({ limits: { heartbeatMs: 10 } })
    const user = await devLogin(app, 'Sam')
    const league = await createLeague(user)
    const reader = await drainInitial(await user.get(`/api/leagues/${league.id}/events`))
    if (reason === 'expiry') clock.advanceDays(61)
    else if (reason === 'revocation') db.run('DELETE FROM sessions')
    else db.run('DELETE FROM league_members WHERE league_id = ?', league.id)
    expect((await reader.read()).done).toBe(true)
  })

  it('immediately closes removed members, with no later league events', async () => {
    const { app } = setup()
    const owner = await devLogin(app, 'Owner')
    const member = await devLogin(app, 'Member')
    const league = await createLeague(owner)
    await joinLeague(member, league.inviteCode)
    const reader = await drainInitial(await member.get(`/api/leagues/${league.id}/events`))
    await owner.json('DELETE', `/api/leagues/${league.id}/members/${member.userId}`, 204)
    await owner.json('PATCH', `/api/leagues/${league.id}`, 200, { name: 'Private now' })
    expect((await reader.read()).done).toBe(true)
  })

  it('rate limits public invite previews and redacts invite codes in logs', async () => {
    const logs: string[] = []
    const logger = { info: (...args: unknown[]) => logs.push(args.join(' ')), warn: () => {}, error: () => {} }
    const { app, clock } = setup({ deps: { accessLog: true, logger } })
    const user = await devLogin(app, 'Sam')
    const league = await createLeague(user)
    const anonymous = new Client(app)
    for (let i = 0; i < 60; i++) await anonymous.json('GET', `/api/invites/${league.inviteCode}`, 200)
    await anonymous.json('GET', `/api/invites/${league.inviteCode}`, 429)
    expect(logs.join('\n')).not.toContain(league.inviteCode)
    clock.advance(61_000)
    await anonymous.json('GET', `/api/invites/${league.inviteCode}`, 200)
  })

  it('does not log callback codes or provider exception contents', async () => {
    const logs: string[] = []
    const capture = (...args: unknown[]) => logs.push(args.join(' '))
    const { app, google } = setup({ deps: { accessLog: true, logger: { info: capture, warn: capture, error: capture } } })
    const client = new Client(app)
    const start = await client.get('/auth/google')
    const url = new URL(start.headers.get('location')!)
    google.exchangeCode = async () => { throw new Error('sensitive-provider-token') }
    const result = await client.get(`/auth/google/callback?state=${url.searchParams.get('state')}&code=sensitive-code`)
    expect(result.headers.get('location')).toBe('/login?error=google_failed')
    expect(logs.join('\n')).not.toContain('sensitive-')
    expect(logs.join('\n')).not.toContain(url.searchParams.get('state'))
  })

  it('caps rate limiter key allocation and reclaims expired keys', () => {
    let time = new Date()
    const limiter = new RateLimiter(60, 60_000, () => time)
    for (let i = 0; i < 10_000; i++) expect(limiter.hit(String(i))).toBe(true)
    expect(limiter.hit('overflow')).toBe(false)
    time = new Date(time.getTime() + 61_000)
    expect(limiter.hit('overflow')).toBe(true)
  })
})
