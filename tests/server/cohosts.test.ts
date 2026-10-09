import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { Db, migrate, SCHEMA_VERSION } from '../../server/db'
import type { LeagueResponse, MatchEvent } from '../../src/shared/api'
import { act, CHECKOUT_101, Client, createLeague, createMatch, current, devLogin, finish, joinLeague, ORIGIN, play, setup, SseReader } from './helpers'

const contexts: ReturnType<typeof setup>[] = []
afterEach(() => {
  for (const ctx of contexts.splice(0)) { ctx.app.services.hub.closeAll(); ctx.app.services.bots.stop(); ctx.db.close() }
})
async function fixture() {
  const ctx = setup(); contexts.push(ctx)
  const owner = await devLogin(ctx.app, 'Owner')
  const host = await devLogin(ctx.app, 'Host')
  const member = await devLogin(ctx.app, 'Member')
  const outsider = await devLogin(ctx.app, 'Outsider')
  const league = await createLeague(owner)
  for (const client of [host, member]) await joinLeague(client, league.inviteCode)
  const base = `/api/leagues/${league.id}`
  const role = (actor: Client, target: Client | string, value: unknown = 'cohost', status = 200) => actor.json<LeagueResponse>('PATCH', `${base}/members/${typeof target === 'string' ? target : target.userId}`, status, { role: value })
  return { ctx, owner, host, member, outsider, league, base, role }
}

describe('co-hosts', () => {
  it('restricts promotion/demotion to current authorized registered members of this league', async () => {
    const { owner, host, member, outsider, league, base, role } = await fixture()
    await role(new Client(owner.app), host, 'cohost', 401)
    await role(outsider, host, 'cohost', 404)
    await role(member, member, 'cohost', 403)
    for (const invalid of ['owner', '', null, 1, {}, ['cohost']]) await role(owner, host, invalid, 400)
    await owner.json('PATCH', `${base}/members/${host.userId}`, 400, {})
    await owner.json('PATCH', `${base}/members/${host.userId}`, 400, [])
    await role(owner, outsider, 'cohost', 404)
    await role(owner, 'not-an-id', 'cohost', 404)
    await role(owner, owner, 'member', 403)
    const { guest } = await owner.json('POST', `${base}/guests`, 201, { name: 'Guest' })
    await role(owner, guest.id, 'cohost', 400)
    const guestClient = new Client(owner.app)
    await guestClient.json('POST', `/api/invites/${league.inviteCode}/guest`, 200, { guestId: guest.id })
    await role(guestClient, host, 'cohost', 403)
    expect((await owner.request('PATCH', `${base}/members/${host.userId}`, { rawBody: '{', headers: { 'content-type': 'application/json' } })).status).toBe(400)
    const promoted = await role(owner, host)
    expect(promoted.league.members.find((m) => m.id === host.userId)?.role).toBe('cohost')
    expect((await host.json('GET', base, 200)).league.role).toBe('cohost')
    expect((await host.json('GET', '/api/leagues', 200)).leagues[0].role).toBe('cohost')
    await role(host, host, 'cohost', 403)
    await role(host, host, 'member', 403)
    await role(host, member)
    await role(host, member, 'member', 403)
    await role(host, owner, 'member', 403)
    await role(owner, member, 'member')
    const other = await createLeague(outsider)
    await joinLeague(host, other.inviteCode)
    await host.json('PATCH', `/api/leagues/${other.id}/members/${outsider.userId}`, 403, { role: 'member' })
    const otherMatch = await createMatch(outsider, other.id, [{ userId: outsider.userId! }, { guestName: 'Other guest' }])
    expect((await current(host, otherMatch.id)).canScore).toBe(false)
    await act(host, otherMatch, { type: 'submit', entry: '20' }, 403)
    await host.json('DELETE', `/api/matches/${otherMatch.id}`, 403)
    await host.json('DELETE', base, 403)
    await role(owner, host, 'member')
    await role(host, member, 'cohost', 403)
    expect((await owner.json('GET', base, 200)).league.id).toBe(league.id)
  })

  it('permits host management, protects hosts and owner, and rejoins as an ordinary member', async () => {
    const { owner, host, member, league, base, role } = await fixture()
    await role(owner, host)
    await host.json('PATCH', base, 200, { name: 'Renamed' })
    const { inviteCode } = await host.json('POST', `${base}/invite`, 200)
    expect(inviteCode).not.toBe(league.inviteCode)
    await role(host, member)
    await host.json('DELETE', `${base}/members/${member.userId}`, 403)
    await host.json('DELETE', `${base}/members/${owner.userId}`, 403)
    await owner.json('DELETE', `${base}/members/${owner.userId}`, 400)
    await role(owner, member, 'member')
    await host.json('DELETE', `${base}/members/${member.userId}`, 204)
    const { guest } = await owner.json('POST', `${base}/guests`, 201, { name: 'Guest' })
    await host.json('DELETE', `${base}/members/${guest.id}`, 204)
    await host.json('DELETE', `${base}/members/${host.userId}`, 204)
    await host.json('PATCH', base, 404, { name: 'No' })
    await joinLeague(host, inviteCode)
    expect((await host.json('GET', base, 200)).league.role).toBe('member')
    await host.json('POST', `${base}/invite`, 403)
    await host.json('PATCH', base, 403, { name: 'No' })
    await role(owner, host)
    await owner.json('DELETE', `${base}/members/${host.userId}`, 204)
  })

  it('grants scoring/reset/save/delete and revokes non-participant rights; refreshes live and completed SSE', async () => {
    const { owner, host, member, base, league, role } = await fixture()
    let live = await createMatch(owner, league.id, [{ userId: owner.userId! }, { userId: member.userId! }])
    let completed = await createMatch(owner, league.id, [{ userId: owner.userId! }, { userId: member.userId! }])
    completed = await finish(owner, await play(owner, completed, CHECKOUT_101))
    const streams = await Promise.all([live, completed].map(async (match) => new SseReader(await host.get(`/api/matches/${match.id}/events`))))
    const leagueStream = new SseReader(await host.get(`${base}/events`))
    try {
      for (const stream of streams) expect((await stream.nextEvent<MatchEvent>('match')).match.canDelete).toBe(false)
      await leagueStream.nextEvent('league')
      await act(host, live, { type: 'submit', entry: '20' }, 403)
      await role(owner, host)
      expect((await streams[0].waitFor<MatchEvent>('match', (e) => e.match.canScore)).match.canResetLeg).toBe(true)
      expect((await streams[1].waitFor<MatchEvent>('match', (e) => e.match.canDelete)).match.status).toBe('completed')
      await leagueStream.waitFor<{ type: string }>('league', (e) => e.type === 'refresh')
      live = await act(host, live, { type: 'submit', entry: '20' })
      live = await act(host, live, { type: 'resetLeg' })
      await role(owner, host, 'member')
      await streams[0].waitFor<MatchEvent>('match', (e) => !e.match.canScore && !e.match.canDelete)
      await streams[1].waitFor<MatchEvent>('match', (e) => !e.match.canDelete)
      await act(host, live, { type: 'resetLeg' }, 403)
      await host.json('DELETE', `/api/matches/${completed.id}`, 403)
      await role(owner, host)
      live = await finish(host, await play(host, live, CHECKOUT_101))
      expect(live.status).toBe('completed')
      await host.json('DELETE', `/api/matches/${completed.id}`, 204)
      const another = await createMatch(owner, league.id, [{ userId: owner.userId! }, { userId: member.userId! }])
      expect((await current(host, another.id)).canDelete).toBe(true)
      await host.json('DELETE', `/api/matches/${another.id}`, 204)
    } finally { for (const stream of [...streams, leagueStream]) await stream.cancel() }
  })

  it.each(['demote', 'remove', 'target-remove'] as const)('rechecks current actor and target after body read: %s', async (change) => {
    const { ctx, owner, host, member, base, role } = await fixture()
    await role(owner, host)
    let release!: () => void
    let reading!: () => void
    const started = new Promise<void>((resolve) => { reading = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const body = new ReadableStream<Uint8Array>({ async pull(controller) {
      reading(); await gate
      controller.enqueue(new TextEncoder().encode('{"role":"cohost"}')); controller.close()
    } })
    const request = new Request(`${ORIGIN}${base}/members/${member.userId}`, {
      method: 'PATCH', headers: { cookie: host.cookieHeader(), origin: ORIGIN, 'content-type': 'application/json' }, body, duplex: 'half',
    } as RequestInit)
    const pending = ctx.app.fetch(request)
    await started
    // Let the route reach its body read before changing membership.
    await new Promise((resolve) => setTimeout(resolve, 10))
    if (change === 'demote') await role(owner, host, 'member')
    else await owner.json('DELETE', `${base}/members/${change === 'remove' ? host.userId : member.userId}`, 204)
    release()
    expect((await pending).status).toBe(change === 'demote' ? 403 : 404)
  })
})

it('migrates v6 membership without changing rowids, rows, avatars, indexes or foreign keys', () => {
  const db = new Db(new DatabaseSync(':memory:'))
  try {
    db.raw.exec('PRAGMA foreign_keys = ON')
    migrate(db, 6)
    for (const id of ['owner', 'member', 'guest']) db.run("INSERT INTO users (id, google_sub, email, name, created_at, last_login_at) VALUES (?, ?, '', ?, 'now', 'now')", id, id, id)
    db.run("INSERT INTO leagues VALUES ('league', 'League', 'owner', 'INVITE', 'now', 'now')")
    db.run("INSERT INTO league_members (rowid, league_id, user_id, role, joined_at) VALUES (9, 'league', 'owner', 'owner', 'now'), (21, 'league', 'member', 'member', 'now'), (4, 'league', 'guest', 'member', 'now')")
    db.run("UPDATE users SET is_guest = 1, guest_league_id = 'league', guest_name_key = 'guest' WHERE id = 'guest'")
    db.run("INSERT INTO user_avatars VALUES ('member', 'version', ?)", new Uint8Array([1, 2, 3]))
    const before = db.all('SELECT rowid, * FROM league_members ORDER BY rowid')
    const indexes = db.all('PRAGMA index_list(league_members)')
    const fks = db.all('PRAGMA foreign_key_list(league_members)')
    migrate(db); migrate(db)
    expect(db.get('PRAGMA user_version')).toEqual({ user_version: SCHEMA_VERSION })
    expect(db.all('SELECT rowid, * FROM league_members ORDER BY rowid')).toEqual(before)
    expect(db.all('PRAGMA index_list(league_members)')).toEqual(indexes)
    expect(db.all('PRAGMA foreign_key_list(league_members)')).toEqual(fks)
    expect(db.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 })
    expect(db.all('PRAGMA foreign_key_check')).toEqual([])
    expect(db.get<{ image: Uint8Array }>('SELECT image FROM user_avatars')?.image).toEqual(new Uint8Array([1, 2, 3]))
    db.run("UPDATE league_members SET role = 'cohost' WHERE user_id = 'member'")
    expect(() => db.run("UPDATE league_members SET role = 'invalid' WHERE user_id = 'member'")).toThrow()
    expect(() => db.run("INSERT INTO league_members VALUES ('league', 'missing', 'member', 'now')")).toThrow()
    db.run("DELETE FROM users WHERE id = 'guest'")
    expect(db.get("SELECT 1 FROM league_members WHERE user_id = 'guest'")).toBeUndefined()
    db.run("DELETE FROM leagues WHERE id = 'league'")
    expect(db.all('SELECT * FROM league_members')).toEqual([])
  } finally { db.close() }
})
