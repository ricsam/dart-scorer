import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app'
import { type TrainingSession } from '../../src/shared/training'
import { Client, createRoom, devLogin, joinRoom, setup, type TestContext } from './helpers'
let ctx: TestContext
const contexts: TestContext[] = []
afterEach(() => { for (const c of contexts.splice(0)) { c.app.services.bots.stop(); c.db.close() } })
async function init() { ctx = setup(); contexts.push(ctx); return devLogin(ctx.app, 'Alice') }
async function create(client: Client, body: unknown = { mode: 'nine-dart' }) { return (await client.json('POST', '/api/training', 201, body)).session as TrainingSession }
async function act(client: Client, s: TrainingSession, entry: string) { return (await client.json('POST', `/api/training/${s.id}/actions`, 200, { baseVersion: s.version, action: { type: 'submit', entry } })).session as TrainingSession }
describe('persistent training API', () => {
  it('persists a batch as one version, rejects stale batches, and undoes one dart', async () => {
    const alice = await init()
    let s = await create(alice)
    s = await act(alice, s, 'T20, D20 + SB MISS 1')
    expect(s.version).toBe(1)
    expect(s.state.throws).toHaveLength(5)
    expect(s.results[0].points).toBe(126)
    const conflict = await alice.json('POST', `/api/training/${s.id}/actions`, 409, { baseVersion: 0, action: { type: 'submit', entry: '1 2 3 4' } })
    expect(conflict.session).toEqual(s)
    const reloaded = new Client(createApp({ db: ctx.db, config: ctx.config, now: ctx.clock.now }))
    reloaded.cookies = alice.cookies
    try { expect((await reloaded.json('GET', `/api/training/${s.id}`, 200)).session).toEqual(s) }
    finally { reloaded.app.services.bots.stop() }
    s = (await alice.json('POST', `/api/training/${s.id}/actions`, 200, { baseVersion: 1, action: { type: 'undo' } })).session
    expect(s.version).toBe(2)
    expect(s.state.throws).toHaveLength(4)
    s = await act(alice, s, '1 2 3 4 5')
    expect(s).toMatchObject({ version: 3, status: 'completed', canScore: false })
    expect(s.results[0]).toMatchObject({ darts: 9, points: 140 })
  })
  it('rejects invalid/oversized/early-finish batches without changing stored state or version', async () => {
    const alice = await init()
    const s = await create(alice, { mode: 'around-clock' })
    const clock = Array.from({ length: 20 }, (_, i) => String(i + 1)).join(' ')
    for (const entry of ['', '1 2 180 3', '1 60 2', '1'.repeat(8193), Array(61).fill('MISS').join(' '), `${clock} MISS`]) {
      await alice.json('POST', `/api/training/${s.id}/actions`, 400, { baseVersion: 0, action: { type: 'submit', entry } })
      expect((await alice.json('GET', `/api/training/${s.id}`, 200)).session).toEqual(s)
    }
    const finished = await act(alice, s, clock)
    expect(finished).toMatchObject({ version: 1, status: 'completed' })
    expect(finished.results[0]).toMatchObject({ darts: 20, hits: 20 })
    const nine = await act(alice, await create(alice), Array(9).fill('T20').join(' '))
    expect(nine).toMatchObject({ version: 1, status: 'completed' })
    expect(nine.results[0].points).toBe(540)
  })
  it('persists across app reload, conflicts on duplicate submissions and never touches career tables', async () => {
    const alice = await init()
    let s = await create(alice)
    const initial = s
    s = await act(alice, s, 'MISS')
    const conflict = await alice.json('POST', `/api/training/${s.id}/actions`, 409, { baseVersion: initial.version, action: { type: 'submit', entry: 'T20' } })
    expect(conflict.session.version).toBe(1)
    const reloaded = new Client(createApp({ db: ctx.db, config: ctx.config, now: ctx.clock.now }))
    reloaded.cookies = alice.cookies
    expect((await reloaded.json('GET', `/api/training/${s.id}`, 200)).session).toEqual(s)
    for (let i = 1; i < 9; i++) s = await act(alice, s, i === 8 ? 'T20' : 'MISS')
    expect(s).toMatchObject({ status: 'completed', canScore: false, completedAt: ctx.clock.now().toISOString() })
    expect(s.results[0]).toMatchObject({ darts: 9, points: 60, score: 60 })
    await alice.json('POST', `/api/training/${s.id}/actions`, 400, { baseVersion: s.version, action: { type: 'undo' } })
    expect((await alice.json('GET', '/api/training?status=live', 200)).sessions).toHaveLength(0)
    expect((await alice.json('GET', '/api/training?status=completed', 200)).sessions).toHaveLength(1)
    for (const table of ['matches', 'match_results', 'match_players']) expect(ctx.db.get<{ n: number }>(`SELECT count(*) n FROM ${table}`)?.n).toBe(0)
    await alice.json('DELETE', `/api/training/${s.id}`, 204)
    reloaded.app.services.bots.stop()
  })
  it('enforces private solo, room readers, participant scoring, creator deletion and current membership', async () => {
    const alice = await init()
    const bob = await devLogin(ctx.app, 'Bob')
    const reader = await devLogin(ctx.app, 'Reader')
    const room = await createRoom(alice)
    await joinRoom(bob, room.inviteCode); await joinRoom(reader, room.inviteCode)
    const solo = await create(alice)
    await bob.json('GET', `/api/training/${solo.id}`, 404)
    const s = await create(alice, { mode: 'around-clock', roomId: room.id, playerIds: [alice.userId, bob.userId] })
    expect((await reader.json('GET', `/api/training/${s.id}`, 200)).session.canScore).toBe(false)
    expect((await reader.json('GET', '/api/training', 200)).sessions).toHaveLength(0)
    await reader.json('POST', `/api/training/${s.id}/actions`, 403, { baseVersion: 0, action: { type: 'submit', entry: '1' } })
    await bob.json('DELETE', `/api/training/${s.id}`, 403)
    const next = await act(bob, s, 'D1')
    expect(next.results[0].hits).toBe(1)
    ctx.db.run('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', room.id, bob.userId)
    await bob.json('GET', `/api/training/${s.id}`, 404)
    await bob.json('POST', `/api/training/${s.id}/actions`, 404, { baseVersion: 1, action: { type: 'undo' } })
    expect((await bob.json('GET', '/api/training', 200)).sessions).toHaveLength(0)
  })
  it('allows scoped guests and rejects nonmembers and foreign-room guests', async () => {
    const alice = await init()
    const room = await createRoom(alice)
    const other = await createRoom(alice, 'Other')
    const guest = (await alice.json('POST', `/api/rooms/${room.id}/guests`, 201, { name: 'Guest' })).guest
    const foreign = (await alice.json('POST', `/api/rooms/${other.id}/guests`, 201, { name: 'Foreign' })).guest
    const s = await create(alice, { mode: 'nine-dart', roomId: room.id, playerIds: [alice.userId, guest.id] })
    expect(s.players[1]).toMatchObject({ id: guest.id, guest: true })
    for (const id of [foreign.id, 'nonmember', 'bot-rookie']) await alice.json('POST', '/api/training', 400, { mode: 'nine-dart', roomId: room.id, playerIds: [alice.userId, id] })
    const guestClient = new Client(ctx.app)
    await guestClient.json('POST', `/api/invites/${room.inviteCode}/guest`, 200, { guestId: guest.id })
    expect((await create(guestClient)).players[0].guest).toBe(true)
    await act(guestClient, s, 'MISS')
  })
  it('rechecks room membership after asynchronous body reading', async () => {
    const alice = await init()
    const room = await createRoom(alice)
    const s = await create(alice, { mode: 'nine-dart', roomId: room.id })
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      ctx.db.run('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', room.id, alice.userId)
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ baseVersion: 0, action: { type: 'submit', entry: 'T20' } })))
      controller.close()
    } }, { highWaterMark: 0 })
    const response = await ctx.app.request(`/api/training/${s.id}/actions`, { method: 'POST', headers: { cookie: alice.cookieHeader(), origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit)
    expect(response.status).toBe(404)
    expect(JSON.parse(ctx.db.get<{ state: string }>('SELECT state FROM training_sessions WHERE id = ?', s.id)!.state).throws).toHaveLength(0)
  })
  it('rejects malformed creation/actions, duplicates and excessive live sessions; undo restores results', async () => {
    const alice = await init()
    for (const body of [null, {}, { mode: 'other' }, { mode: 'nine-dart', playerIds: [] }, { mode: 'nine-dart', playerIds: [alice.userId, alice.userId] }, { mode: 'nine-dart', playerIds: ['bot:foo'] }]) await alice.json('POST', '/api/training', 400, body)
    let s = await create(alice)
    for (const action of [null, {}, { type: 'submit', entry: '1 180 2' }, { type: 'submit', entry: 0 }, { type: 'submit', entry: '180' }, { type: 'undo' }]) await alice.json('POST', `/api/training/${s.id}/actions`, 400, { baseVersion: 0, action })
    s = await act(alice, s, '0')
    s = (await alice.json('POST', `/api/training/${s.id}/actions`, 200, { baseVersion: s.version, action: { type: 'undo' } })).session
    expect(s.results[0]).toMatchObject({ darts: 0, score: 0 })
    await alice.json('GET', '/api/training?status=bogus', 400)
    for (let i = 1; i < 10; i++) await create(alice)
    await alice.json('POST', '/api/training', 400, { mode: 'nine-dart' })
  })
})
