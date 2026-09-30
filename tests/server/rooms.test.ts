import { describe, expect, it } from 'vitest'
import type { InvitePreview, RoomDetail, RoomsResponse } from '../../src/shared/api'
import { Client, CHECKOUT_101, createMatch, createRoom, devLogin, finish, joinRoom, play, setup } from './helpers'

describe('rooms', () => {
  it('creates, lists, shows, renames and deletes rooms with owner-only permissions', async () => {
    const ctx = setup()
    const owner = await devLogin(ctx.app, 'Olivia')
    const member = await devLogin(ctx.app, 'Max')
    const outsider = await devLogin(ctx.app, 'Nora')

    const { room } = await owner.json<{ room: RoomDetail }>('POST', '/api/rooms', 201, { name: '  Friday Arrows  ' })
    expect(room).toMatchObject({
      name: 'Friday Arrows',
      role: 'owner',
      owner: { id: owner.userId, name: 'Olivia' },
      liveMatches: [],
      recentMatches: [],
      defaults: { game: 501, doubleIn: false, doubleOut: true, legsToWin: 3 },
    })
    expect(room.id).toMatch(/^[A-Za-z0-9_-]{16,}$/)
    expect(room.inviteCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/)
    expect(room.members).toEqual([expect.objectContaining({ id: owner.userId, role: 'owner', rating: 1000, matches: 0 })])

    await owner.json('POST', '/api/rooms', 400, { name: '' })
    await owner.json('POST', '/api/rooms', 400, { name: 'x'.repeat(41) })
    await owner.json('POST', '/api/rooms', 400, {})
    await owner.json('POST', '/api/rooms', 400, ['name'])

    await joinRoom(member, room.inviteCode)
    const memberView = await member.json<{ room: RoomDetail }>('GET', `/api/rooms/${room.id}`, 200)
    expect(memberView.room.role).toBe('member')
    expect(memberView.room.inviteCode).toBe(room.inviteCode)
    expect(memberView.room.members.map((m) => m.name)).toEqual(['Olivia', 'Max'])

    // Outsiders can't tell the room exists.
    expect(await outsider.json('GET', `/api/rooms/${room.id}`, 404)).toMatchObject({ error: 'not_found' })
    await outsider.json('PATCH', `/api/rooms/${room.id}`, 404, { name: 'Mine' })
    await outsider.json('DELETE', `/api/rooms/${room.id}`, 404)
    await outsider.json('GET', '/api/rooms/does-not-exist', 404)

    // Members can't rename or delete.
    await member.json('PATCH', `/api/rooms/${room.id}`, 403, { name: 'Max Room' })
    await member.json('DELETE', `/api/rooms/${room.id}`, 403)
    const renamed = await owner.json<{ room: RoomDetail }>('PATCH', `/api/rooms/${room.id}`, 200, { name: 'Saturday Arrows' })
    expect(renamed.room.name).toBe('Saturday Arrows')

    const list = await member.json<RoomsResponse>('GET', '/api/rooms', 200)
    expect(list.rooms).toEqual([expect.objectContaining({
      id: room.id,
      name: 'Saturday Arrows',
      role: 'member',
      memberCount: 2,
      liveMatches: 0,
      completedMatches: 0,
      myRating: 1000,
      myRank: null,
    })])
    expect(list.rooms[0].members.map((m) => m.name)).toEqual(['Olivia', 'Max'])
    expect((await outsider.json<RoomsResponse>('GET', '/api/rooms', 200)).rooms).toEqual([])

    // Deleting cascades to matches and results.
    const match = await createMatch(owner, room.id, [{ userId: owner.userId! }, { userId: member.userId! }])
    await finish(owner, await play(owner, match, CHECKOUT_101))
    expect(ctx.db.all('SELECT * FROM match_results')).toHaveLength(2)
    expect((await owner.delete(`/api/rooms/${room.id}`)).status).toBe(204)
    await owner.json('GET', `/api/rooms/${room.id}`, 404)
    await member.json('GET', `/api/matches/${match.id}`, 404)
    expect(ctx.db.all('SELECT * FROM matches')).toHaveLength(0)
    expect(ctx.db.all('SELECT * FROM match_results')).toHaveLength(0)
    expect(ctx.db.all('SELECT * FROM room_members')).toHaveLength(0)
  })

  it('orders rooms by latest activity and summarizes members', async () => {
    const ctx = setup()
    const owner = await devLogin(ctx.app, 'Olivia')
    const first = await createRoom(owner, 'First')
    ctx.clock.advance(1000)
    const second = await createRoom(owner, 'Second')
    ctx.clock.advance(1000)
    let rooms = (await owner.json<RoomsResponse>('GET', '/api/rooms', 200)).rooms
    expect(rooms.map((room) => room.name)).toEqual(['Second', 'First'])

    const friends = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((name) => devLogin(ctx.app, name)))
    for (const friend of friends) await joinRoom(friend, first.inviteCode)
    rooms = (await owner.json<RoomsResponse>('GET', '/api/rooms', 200)).rooms
    expect(rooms.map((room) => room.name)).toEqual(['First', 'Second'])
    expect(rooms[0].memberCount).toBe(6)
    expect(rooms[0].members.map((m) => m.name)).toEqual(['Olivia', 'A', 'B', 'C', 'D'])

    ctx.clock.advance(1000)
    await createMatch(owner, second.id, [{ userId: owner.userId! }, { guestName: 'Guest' }])
    rooms = (await owner.json<RoomsResponse>('GET', '/api/rooms', 200)).rooms
    expect(rooms[0]).toMatchObject({ name: 'Second', liveMatches: 1 })
  })

  it('limits each user to 20 owned rooms', async () => {
    const ctx = setup()
    const owner = await devLogin(ctx.app, 'Olivia')
    for (let i = 0; i < 20; i += 1) await createRoom(owner, `Room ${i}`)
    expect(await owner.json('POST', '/api/rooms', 400, { name: 'One too many' })).toMatchObject({ error: 'bad_request' })
  })
})

describe('invites', () => {
  it('previews signed out, joins idempotently and regenerates codes', async () => {
    const ctx = setup()
    const owner = await devLogin(ctx.app, 'Olivia')
    const room = await createRoom(owner, 'Arrows')

    const anonymous = new Client(ctx.app)
    const preview = await anonymous.json<InvitePreview>('GET', `/api/invites/${room.inviteCode}`, 200)
    expect(preview).toEqual({
      room: { id: room.id, name: 'Arrows', memberCount: 1, owner: { id: owner.userId, name: 'Olivia', avatarUrl: null } },
      member: false,
      guests: [],
    })
    // Codes are case-insensitive for people typing them in.
    expect((await anonymous.json<InvitePreview>('GET', `/api/invites/${room.inviteCode.toLowerCase()}`, 200)).room.id).toBe(room.id)
    expect((await owner.json<InvitePreview>('GET', `/api/invites/${room.inviteCode}`, 200)).member).toBe(true)
    await anonymous.json('GET', '/api/invites/AAAAAAAAAA', 404)
    await anonymous.json('GET', '/api/invites/not-a-code', 404)
    await anonymous.json('POST', `/api/invites/${room.inviteCode}/join`, 401)

    const guest = await devLogin(ctx.app, 'Max')
    expect(await guest.json('POST', `/api/invites/${room.inviteCode}/join`, 200)).toEqual({ roomId: room.id })
    expect(await guest.json('POST', `/api/invites/${room.inviteCode}/join`, 200)).toEqual({ roomId: room.id })
    expect((await guest.json<InvitePreview>('GET', `/api/invites/${room.inviteCode}`, 200)).member).toBe(true)
    expect((await owner.json<{ room: RoomDetail }>('GET', `/api/rooms/${room.id}`, 200)).room.members).toHaveLength(2)

    await guest.json('POST', `/api/rooms/${room.id}/invite`, 403)
    const { inviteCode } = await owner.json<{ inviteCode: string }>('POST', `/api/rooms/${room.id}/invite`, 200)
    expect(inviteCode).not.toBe(room.inviteCode)
    const late = await devLogin(ctx.app, 'Late')
    await late.json('POST', `/api/invites/${room.inviteCode}/join`, 404)
    await late.json('POST', `/api/invites/${inviteCode}/join`, 200)
  })

  it('caps rooms at 100 members', async () => {
    const ctx = setup()
    const owner = await devLogin(ctx.app, 'Olivia')
    const room = await createRoom(owner, 'Crowded')
    const now = new Date().toISOString()
    for (let i = 0; i < 99; i += 1) {
      ctx.db.run('INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, last_login_at) VALUES (?, ?, ?, ?, NULL, ?, ?)', `u${i}`, `dev:u${i}`, `u${i}@x`, `U${i}`, now, now)
      ctx.db.run("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)", room.id, `u${i}`, now)
    }
    const extra = await devLogin(ctx.app, 'Extra')
    expect(await extra.json('POST', `/api/invites/${room.inviteCode}/join`, 400)).toMatchObject({ error: 'bad_request' })
  })
})

describe('members', () => {
  it('lets the owner remove members and members leave, but not the owner', async () => {
    const ctx = setup()
    const owner = await devLogin(ctx.app, 'Olivia')
    const max = await devLogin(ctx.app, 'Max')
    const nora = await devLogin(ctx.app, 'Nora')
    const room = await createRoom(owner, 'Arrows')
    await joinRoom(max, room.inviteCode)
    await joinRoom(nora, room.inviteCode)

    // Historical results survive removal.
    const match = await createMatch(owner, room.id, [{ userId: max.userId! }, { userId: nora.userId! }])
    await finish(max, await play(max, match, CHECKOUT_101))

    await max.json('DELETE', `/api/rooms/${room.id}/members/${nora.userId}`, 403)
    await max.json('DELETE', `/api/rooms/${room.id}/members/${owner.userId}`, 403)
    expect(await owner.json('DELETE', `/api/rooms/${room.id}/members/${owner.userId}`, 400)).toMatchObject({ error: 'bad_request' })
    await owner.json('DELETE', `/api/rooms/${room.id}/members/unknown-user`, 404)

    expect((await owner.delete(`/api/rooms/${room.id}/members/${nora.userId}`)).status).toBe(204)
    await nora.json('GET', `/api/rooms/${room.id}`, 404)
    await nora.json('GET', `/api/matches/${match.id}`, 404)
    await nora.json('DELETE', `/api/rooms/${room.id}/members/${nora.userId}`, 404)

    expect((await max.delete(`/api/rooms/${room.id}/members/${max.userId}`)).status).toBe(204)
    await max.json('GET', `/api/rooms/${room.id}`, 404)

    const detail = await owner.json<{ room: RoomDetail }>('GET', `/api/rooms/${room.id}`, 200)
    expect(detail.room.members.map((m) => m.name)).toEqual(['Olivia'])
    expect(detail.room.recentMatches).toHaveLength(1)
    expect(detail.room.recentMatches[0].players.map((p) => p.name)).toEqual(['Max', 'Nora'])
    expect(ctx.db.all('SELECT * FROM match_results WHERE user_id IS NOT NULL')).toHaveLength(2)

    // A removed member can rejoin with the invite.
    await joinRoom(nora, room.inviteCode)
    await nora.json('GET', `/api/matches/${match.id}`, 200)
  })
})
