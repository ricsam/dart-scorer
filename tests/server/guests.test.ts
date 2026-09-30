import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { Db, migrate, SCHEMA_VERSION } from '../../server/db'
import { Client, createRoom, createMatch, devLogin, setup, DEFAULTS_101, play, finish, CHECKOUT_101 } from './helpers'

const contexts: ReturnType<typeof setup>[] = []
afterEach(() => { for (const ctx of contexts.splice(0)) { ctx.app.services.hub.closeAll(); ctx.db.close() } })
async function fixture() {
  const ctx = setup(); contexts.push(ctx)
  const owner = await devLogin(ctx.app, 'Owner')
  const room = await createRoom(owner)
  const url = `/api/invites/${room.inviteCode}/guest`
  const rosterUrl = `/api/rooms/${room.id}/guests`
  return { ...ctx, owner, room, url, rosterUrl }
}

describe('persistent room guests', () => {
  it('reuses normalized roster names, claims exactly once and preserves identity after logout', async () => {
    const { app, owner, room, url, rosterUrl } = await fixture()
    const { guest } = await owner.json('POST', rosterUrl, 201, { name: 'Guest One' })
    expect(guest).toMatchObject({ guest: true, claimed: false, rating: 1000 })
    expect((await owner.json('POST', rosterUrl, 201, { name: ' guest   ONE ' })).guest.id).toBe(guest.id)
    await owner.json('POST', rosterUrl, 400, { name: ' owner ' })
    const a = new Client(app), b = new Client(app)
    expect((await a.json('GET', `/api/invites/${room.inviteCode}`, 200)).guests).toEqual([{ id: guest.id, name: 'Guest One' }])
    const responses = await Promise.all([a.post(url, { guestId: guest.id }), b.post(url, { name: 'guest one' })])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 403])
    const winner = responses[0].status === 200 ? a : b
    expect((await winner.json('GET', '/api/me', 200)).user).toMatchObject({ id: guest.id, guest: true })
    await winner.json('POST', url, 200, { guestId: guest.id })
    expect((await a.json('GET', `/api/invites/${room.inviteCode}`, 200)).guests).toEqual([])
    await winner.post('/auth/logout')
    await winner.json('POST', url, 403, { guestId: guest.id })
    await winner.json('POST', url, 403, { name: 'Guest One' })
  })

  it('enforces permissions, isolation, input validation, invite reset and expiry', async () => {
    const { app, owner, room, url, clock } = await fixture()
    const guest = new Client(app)
    for (const body of [{}, { name: '' }, { name: 'a', guestId: 'x' }, { guestId: 2 }, null]) await guest.json('POST', url, 400, body)
    await guest.json('POST', '/api/invites/not-valid/guest', 404, { name: 'Guest' })
    await owner.json('POST', url, 403, { name: 'Guest' })
    await guest.json('POST', url, 200, { name: 'Guest' })
    const id = (await guest.json('GET', '/api/me', 200)).user.id
    await guest.json('POST', '/api/rooms', 403, { name: 'No' })
    await guest.json('PATCH', '/api/me', 403, { name: 'No' })
    await guest.json('GET', '/api/me/stats', 403)
    await guest.json('PATCH', `/api/rooms/${room.id}`, 403, { name: 'No' })
    await guest.json('POST', `/api/rooms/${room.id}/invite`, 403)
    await guest.json('GET', `/api/rooms/${room.id}/players/${id}`, 404)
    const other = await createRoom(owner, 'Other')
    await guest.json('GET', `/api/rooms/${other.id}`, 404)
    await guest.json('POST', `/api/invites/${other.inviteCode}/join`, 403)
    await guest.json('POST', `/api/invites/${other.inviteCode}/guest`, 403, { name: 'Other' })
    await guest.json('POST', url, 403, { name: 'Different' })
    const { inviteCode } = await owner.json('POST', `/api/rooms/${room.id}/invite`, 200)
    await new Client(app).json('POST', url, 404, { name: 'Fresh' })
    clock.advanceDays(61)
    await guest.json('POST', `/api/invites/${inviteCode}/guest`, 403, { guestId: id })
    expect((await guest.json('GET', '/api/me', 200)).user).toBeNull()
  })

  it('uses guestIds for scoring but never ranked userIds; rejects duplicate and cross-room identities transactionally', async () => {
    const { app, owner, room, url, db } = await fixture()
    const match = await createMatch(owner, room.id, [{ guestName: 'Guest' }, { userId: owner.userId! }])
    const id = match.players[0].guestId!
    expect(match.players[0]).toMatchObject({ userId: null, guest: true })
    const guest = new Client(app)
    await guest.json('POST', url, 200, { guestId: id })
    const matchUrl = `/api/rooms/${room.id}/matches`
    for (const players of [[{ guestId: id }, { guestName: ' guest ' }], [{ userId: id }, { guestName: 'new' }], [{ guestName: 'new' }, { guestName: 'NEW' }]]) {
      await owner.json('POST', matchUrl, 400, { players, settings: DEFAULTS_101 })
    }
    expect(db.get('SELECT 1 FROM users WHERE guest_name_key = ?', 'new')).toBeUndefined()
    const other = await createRoom(owner)
    await owner.json('POST', `/api/rooms/${other.id}/matches`, 400, { players: [{ guestId: id }, { userId: owner.userId }], settings: DEFAULTS_101 })
    expect((await guest.json('GET', `/api/matches/${match.id}`, 200)).match.canScore).toBe(true)
    const completed = await finish(guest, await play(guest, match, CHECKOUT_101))
    expect(completed.results![0].ratingAfter).toBeNull()
    expect(completed.results![1]).toMatchObject({ ratingBefore: 1000, ratingAfter: 1000 })
    expect(db.get<{ user_id: null }>('SELECT user_id FROM match_results WHERE match_id = ? AND slot = 0', match.id)!.user_id).toBeNull()
    const leaderboard = await guest.json('GET', `/api/rooms/${room.id}/leaderboard`, 200)
    expect(leaderboard.entries.map((e: { id: string }) => e.id)).toEqual([owner.userId])
    const created = await guest.json('POST', matchUrl, 201, { players: [{ userId: owner.userId }, { guestName: 'Another' }], settings: DEFAULTS_101 })
    expect(created.match.canScore).toBe(true)
    const login = await guest.json('POST', '/auth/dev-login', 200, { name: 'Registered', email: 'registered@example.com' })
    expect(login.user).toMatchObject({ guest: false })
    expect(login.user.id).not.toBe(id)
    expect((await guest.json('GET', '/api/me/stats', 200)).totals.matches).toBe(0)
  })

  it('closes room and match SSE upon removal and never silently rejoins tombstoned guests', async () => {
    const { app, owner, room, url, rosterUrl } = await fixture()
    const guest = new Client(app)
    await guest.json('POST', url, 200, { name: 'Guest' })
    const id = (await guest.json('GET', '/api/me', 200)).user.id
    const match = await createMatch(owner, room.id, [{ guestName: 'Guest' }, { userId: owner.userId! }])
    const readers = []
    for (const path of [`/api/rooms/${room.id}/events`, `/api/matches/${match.id}/events`]) {
      const response = await guest.get(path)
      expect(response.status).toBe(200)
      const reader = response.body!.getReader(); readers.push(reader)
      await reader.read()
    }
    await owner.delete(`/api/rooms/${room.id}/members/${id}`)
    for (const reader of readers) { while (!(await reader.read()).done) { /* drain initial frames */ } }
    await guest.json('GET', `/api/rooms/${room.id}`, 404)
    await guest.json('POST', `/api/invites/${room.inviteCode}/join`, 403)
    await guest.json('POST', url, 404, { guestId: id })
    await owner.json('POST', rosterUrl, 403, { name: 'Guest' })
    await new Client(app).json('POST', url, 404, { guestId: id })
  })

  it('rechecks reset invites and competing claims after a blocked request body', async () => {
    const { app, owner, room, url, rosterUrl } = await fixture()
    const { guest } = await owner.json('POST', rosterUrl, 201, { name: 'Waiting' })
    const delayed = () => {
      let release!: () => void
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        release = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ guestId: guest.id }))); controller.close() }
      } })
      const request = new Request(`http://localhost:5173${url}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body, duplex: 'half' } as RequestInit)
      return { response: app.request(request), release }
    }
    const first = delayed()
    await new Client(app).json('POST', url, 200, { guestId: guest.id })
    first.release()
    expect((await first.response).status).toBe(403)
    const second = delayed()
    await owner.json('POST', `/api/rooms/${room.id}/invite`, 200)
    second.release()
    expect((await second.response).status).toBe(404)
  })

  it('honors CSRF, anonymous claim rate limits and room capacity', async () => {
    const { app, owner, room, url, rosterUrl, db } = await fixture()
    const guest = new Client(app)
    expect((await guest.post(url, { name: 'Guest' }, { headers: { origin: 'https://evil.example' } })).status).toBe(403)
    const template = db.get<Record<string, string>>('SELECT * FROM users WHERE id = ?', owner.userId!)!
    db.transaction(() => { for (let i = 0; i < 99; i++) {
      db.run('INSERT INTO users (id,google_sub,email,name,created_at,last_login_at) VALUES (?,?,?,?,?,?)', `fill${i}`, `fill${i}`, '', 'Fill', template.created_at, template.created_at)
      db.run("INSERT INTO room_members VALUES (?, ?, 'member', ?)", room.id, `fill${i}`, template.created_at)
    } })
    await owner.json('POST', rosterUrl, 400, { name: 'Overflow' })
    await guest.json('POST', url, 400, { name: 'Overflow' })
    let last = 0
    for (let i = 0; i < 125; i++) last = (await guest.post(url, { name: 'Overflow' })).status
    expect(last).toBe(429)
  })
})

it('additive migration preserves legacy match state/results and associates reusable guest slots', () => {
  const source = readFileSync(new URL('../../server/db.ts', import.meta.url), 'utf8')
  const schema = source.split('// 1 — initial schema')[1].split('`')[1]
  const db = new Db(new DatabaseSync(':memory:'))
  db.raw.exec(schema + '; PRAGMA user_version = 1;')
  db.run("INSERT INTO users VALUES ('owner','google','email','Owner',NULL,'now','now')")
  db.run("INSERT INTO rooms VALUES ('room','Room','owner','CODE','now','now')")
  db.run("INSERT INTO room_members VALUES ('room','owner','owner','now')")
  db.run("INSERT INTO matches VALUES ('match','room','owner','completed','{}','{\"preserved\":true}',4,'now','now','now')")
  db.run("INSERT INTO match_players VALUES ('match',0,NULL,'Guest'),('match',1,'owner','Owner'),('match',2,NULL,'GUEST')")
  db.run("INSERT INTO match_results VALUES ('match',0,'room',NULL,1,1,1,1,3,101,1,101,3,0,0,1,1,1,101,3,NULL,NULL,'now')")
  const before = db.all('SELECT * FROM match_results')
  migrate(db); migrate(db)
  expect(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version).toBe(SCHEMA_VERSION)
  expect(db.all('SELECT * FROM match_results')).toEqual(before)
  expect(db.get<{ state: string }>('SELECT state FROM matches')!.state).toBe('{"preserved":true}')
  const slots = db.all<{ guest_id: string | null; user_id: string | null }>('SELECT guest_id,user_id FROM match_players ORDER BY slot')
  expect(slots[0].guest_id).toBeTruthy(); expect(slots[0].user_id).toBeNull()
  expect(slots[1].guest_id).toBeNull(); expect(slots[2].guest_id).toBeNull()
  expect(db.all('SELECT * FROM users WHERE is_guest=1')).toHaveLength(1)
  db.close()
})
