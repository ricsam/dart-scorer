import { describe, expect, it } from 'vitest'
import { eloDeltas } from '../../server/ratings'
import type { MatchConflictResponse, MatchDetail, RoomDetail } from '../../src/shared/api'
import { act, CHECKOUT_101, createMatch, createRoom, devLogin, finish, joinRoom, play, setup, type Client } from './helpers'

async function roomWithPlayers() {
  const ctx = setup()
  const owner = await devLogin(ctx.app, 'Olivia')
  const max = await devLogin(ctx.app, 'Max')
  const nora = await devLogin(ctx.app, 'Nora')
  const outsider = await devLogin(ctx.app, 'Otto')
  const room = await createRoom(owner, 'Arrows')
  await joinRoom(max, room.inviteCode)
  await joinRoom(nora, room.inviteCode)
  return { ctx, owner, max, nora, outsider, room }
}

const players = (...clients: Client[]) => clients.map((client) => ({ userId: client.userId! }))

describe('match creation', () => {
  it('validates players and settings strictly', async () => {
    const { owner, max, outsider, room } = await roomWithPlayers()
    const url = `/api/rooms/${room.id}/matches`
    const settings = { game: 501, doubleIn: false, doubleOut: true, legsToWin: 3 }
    const bad = async (body: unknown) => expect(await owner.json('POST', url, 400, body)).toMatchObject({ error: 'bad_request' })

    await bad({ players: [{ userId: owner.userId }], settings })
    await bad({ players: Array.from({ length: 9 }, (_, i) => ({ guestName: `G${i}` })), settings })
    await bad({ players: [{ userId: owner.userId }, { userId: owner.userId }], settings })
    await bad({ players: [{ userId: owner.userId }, { userId: outsider.userId }], settings })
    await bad({ players: [{ userId: owner.userId }, { guestName: '   ' }], settings })
    await bad({ players: [{ userId: owner.userId }, { guestName: 'x'.repeat(19) }], settings })
    await bad({ players: [{ userId: owner.userId, guestName: 'Both' }, { guestName: 'G' }], settings })
    await bad({ players: [{ userId: 42 }, { guestName: 'G' }], settings })
    await bad({ players: 'everyone', settings })
    await bad({ players: players(owner, max) })
    await bad({ players: players(owner, max), settings: { ...settings, game: 500 } })
    await bad({ players: players(owner, max), settings: { ...settings, legsToWin: 0 } })
    await bad({ players: players(owner, max), settings: { ...settings, legsToWin: 12 } })
    await bad({ players: players(owner, max), settings: { ...settings, legsToWin: 1.5 } })
    await bad({ players: players(owner, max), settings: { ...settings, doubleIn: 'no' } })
    await outsider.json('POST', url, 404, { players: players(owner, max), settings })
  })

  it('snapshots the roster and starts a live match at version 1', async () => {
    const { owner, max, nora, room } = await roomWithPlayers()
    const match = await createMatch(max, room.id, [{ userId: max.userId! }, { guestName: ' Grandpa ' }, { userId: owner.userId! }], {
      game: 301, doubleIn: true, doubleOut: false, legsToWin: 2,
    })
    expect(match).toMatchObject({
      roomId: room.id,
      roomName: 'Arrows',
      status: 'live',
      version: 1,
      settings: { game: 301, doubleIn: true, doubleOut: false, legsToWin: 2 },
      createdBy: { id: max.userId, name: 'Max' },
      completedAt: null,
      canScore: true,
      canDelete: true,
      results: null,
    })
    expect(match.players).toEqual([
      { slot: 0, userId: max.userId, name: 'Max', avatarUrl: null, guest: false },
      { slot: 1, userId: null, name: 'Grandpa', avatarUrl: null, guest: true },
      { slot: 2, userId: owner.userId, name: 'Olivia', avatarUrl: null, guest: false },
    ])
    expect(match.state.players.map((p) => [p.id, p.name, p.score, p.opened])).toEqual([
      ['slot-0', 'Max', 301, false], ['slot-1', 'Grandpa', 301, false], ['slot-2', 'Olivia', 301, false],
    ])
    expect(match.state).toMatchObject({ game: 301, doubleIn: true, doubleOut: false, legsToWin: 2, matchWinner: null })

    // Renaming later doesn't rewrite history.
    await max.json('PATCH', '/api/me', 200, { name: 'Maximilian' })
    expect((await max.json<{ match: MatchDetail }>('GET', `/api/matches/${match.id}`, 200)).match.players[0].name).toBe('Max')

    // Permissions per viewer: Nora is a member but not involved; Olivia plays and owns the room.
    const noraView = (await nora.json<{ match: MatchDetail }>('GET', `/api/matches/${match.id}`, 200)).match
    expect([noraView.canScore, noraView.canDelete]).toEqual([false, false])
    const ownerView = (await owner.json<{ match: MatchDetail }>('GET', `/api/matches/${match.id}`, 200)).match
    expect([ownerView.canScore, ownerView.canDelete]).toEqual([true, true])

    const detail = (await nora.json<{ room: RoomDetail }>('GET', `/api/rooms/${room.id}`, 200)).room
    expect(detail.defaults).toEqual({ game: 301, doubleIn: true, doubleOut: false, legsToWin: 2 })
    expect(detail.liveMatches).toHaveLength(1)
    expect(detail.liveMatches[0]).toMatchObject({ id: match.id, status: 'live', active: 0, awaitingConfirmation: false })
    expect(detail.liveMatches[0].players[1]).toMatchObject({ name: 'Grandpa', guest: true, legs: 0, score: 301, average: 0, won: false })
  })

  it('allows at most 10 live matches per room', async () => {
    const { owner, max, room } = await roomWithPlayers()
    for (let i = 0; i < 10; i += 1) await createMatch(owner, room.id, players(owner, max))
    expect(await owner.json('POST', `/api/rooms/${room.id}/matches`, 400, {
      players: players(owner, max), settings: { game: 501, doubleIn: false, doubleOut: true, legsToWin: 1 },
    })).toMatchObject({ error: 'bad_request' })
  })
})

describe('match actions', () => {
  it('applies scoring with optimistic concurrency', async () => {
    const { owner, max, nora, room } = await roomWithPlayers()
    const match = await createMatch(owner, room.id, players(max, nora))

    const afterDart = await act(max, match, { type: 'submit', entry: 'T20' })
    expect(afterDart.version).toBe(2)
    expect(afterDart.state.players[0].score).toBe(41)
    expect(afterDart.state.currentVisit).toHaveLength(1)

    // A second device still on version 1 gets the fresh match back.
    const conflict = await nora.json<MatchConflictResponse>('POST', `/api/matches/${match.id}/actions`, 409, {
      action: { type: 'submit', entry: 'M' }, baseVersion: 1,
    })
    expect(conflict.error).toBe('conflict')
    expect(conflict.match.version).toBe(2)
    expect(conflict.match.state.players[0].score).toBe(41)

    // The creator (room owner) may score even when not playing.
    const afterVisit = await act(owner, afterDart, { type: 'submit', entry: '9 D16' })
    expect(afterVisit.version).toBe(3)
    expect(afterVisit.state.matchWinner).toBe(0)

    // Undo reopens the match.
    const undone = await act(nora, afterVisit, { type: 'undo' })
    expect(undone.version).toBe(4)
    expect(undone.state.matchWinner).toBeNull()

    // No-op actions don't bump the version.
    const noop = await act(nora, undone, { type: 'nextLeg' })
    expect(noop.version).toBe(4)
    await nora.json('POST', `/api/matches/${match.id}/actions`, 400, { action: { type: 'submit', entry: 'banana' }, baseVersion: 4 })
  })

  it('rejects non-scorers, outsiders and disallowed or malformed actions', async () => {
    const { owner, max, nora, outsider, room } = await roomWithPlayers()
    const match = await createMatch(max, room.id, [{ userId: max.userId! }, { guestName: 'Guest' }])
    const url = `/api/matches/${match.id}/actions`
    const post = (client: Client, status: number, body: unknown) => client.json(client === outsider ? 'POST' : 'POST', url, status, body)

    expect(await post(nora, 403, { action: { type: 'submit', entry: 'T20' }, baseVersion: 1 })).toMatchObject({ error: 'forbidden' })
    expect(await post(outsider, 404, { action: { type: 'submit', entry: 'T20' }, baseVersion: 1 })).toMatchObject({ error: 'not_found' })

    for (const action of [
      { type: 'setGame', game: 101 },
      { type: 'addPlayer', name: 'Sneaky' },
      { type: 'removePlayer', index: 1 },
      { type: 'renamePlayer', index: 0, name: 'Hacker' },
      { type: 'setDoubleOut', value: false },
      { type: 'explode' },
      { type: 'submit' },
      { type: 'submit', entry: 180 },
      { type: 'submit', entry: 'x'.repeat(65) },
      { type: 'rewind', legId: 'leg', visitIndex: -1 },
      { type: 'rewind', legId: 'leg', visitIndex: 1.5 },
      { type: 'rewind', legId: 'l'.repeat(101), visitIndex: 0 },
      { type: 'rewind', visitIndex: 0 },
      'submit',
      null,
    ]) {
      expect(await post(max, 400, { action, baseVersion: 1 })).toMatchObject({ error: 'bad_request' })
    }
    await post(max, 400, { action: { type: 'undo' } })
    await post(max, 400, { action: { type: 'undo' }, baseVersion: '1' })
    await owner.json('POST', '/api/matches/unknown/actions', 404, { action: { type: 'undo' }, baseVersion: 1 })

    const unchanged = (await max.json<{ match: MatchDetail }>('GET', `/api/matches/${match.id}`, 200)).match
    expect(unchanged.version).toBe(1)
    expect(unchanged.state.players.map((p) => p.name)).toEqual(['Max', 'Guest'])
  })

  it('supports rewinding to a visit in a completed leg', async () => {
    const { owner, max, room } = await roomWithPlayers()
    let match = await createMatch(owner, room.id, players(owner, max), { game: 101, doubleIn: false, doubleOut: true, legsToWin: 2 })
    match = await play(owner, match, 'T20 M M', 'M M M', '9 D16')
    expect(match.state.winner).toBe(0)
    expect(match.state.legHistory).toHaveLength(1)
    const legId = match.state.legHistory[0].id
    match = await act(owner, match, { type: 'rewind', legId, visitIndex: 1 })
    expect(match.state.legHistory).toHaveLength(0)
    expect(match.state.winner).toBeNull()
    expect(match.state.active).toBe(1)
    expect(match.state.players[0].score).toBe(41)
  })
})

describe('finishing matches', () => {
  it('records results and Elo ratings (1000 vs 1000 → 1016 / 984)', async () => {
    const { owner, max, nora, room } = await roomWithPlayers()
    let match = await createMatch(owner, room.id, players(max, nora))
    await finish(max, match, 400) // no winner yet
    match = await play(max, match, CHECKOUT_101)
    expect(match.state.matchWinner).toBe(0)

    const summary = (await max.json<{ room: RoomDetail }>('GET', `/api/rooms/${room.id}`, 200)).room.liveMatches[0]
    expect(summary.awaitingConfirmation).toBe(true)

    await max.json('POST', `/api/matches/${match.id}/finish`, 409, { baseVersion: match.version - 1 })
    const done = await finish(nora, match)
    expect(done).toMatchObject({ status: 'completed', version: match.version + 1, canScore: false, canDelete: false })
    expect(done.completedAt).toBe(done.updatedAt)
    expect(done.results).toEqual([
      expect.objectContaining({ slot: 0, placing: 1, won: true, ratingBefore: 1000, ratingAfter: 1016 }),
      expect.objectContaining({ slot: 1, placing: 2, won: false, ratingBefore: 1000, ratingAfter: 984 }),
    ])
    expect(done.results![0].stats).toMatchObject({ legsWon: 1, legsPlayed: 1, darts: 3, points: 101, average: 101, checkouts: 1, highestCheckout: 101, bestLegDarts: 3 })
    expect(done.results![1].stats).toMatchObject({ legsWon: 0, legsPlayed: 1, darts: 0, points: 0 })

    // The room owner (not a player) can only delete; players can no longer score.
    const ownerView = (await owner.json<{ match: MatchDetail }>('GET', `/api/matches/${match.id}`, 200)).match
    expect([ownerView.canScore, ownerView.canDelete]).toEqual([false, true])
    await max.json('POST', `/api/matches/${match.id}/actions`, 400, { action: { type: 'undo' }, baseVersion: done.version })
    await max.json('POST', `/api/matches/${match.id}/actions`, 409, { action: { type: 'undo' }, baseVersion: match.version })
    await max.json('POST', `/api/matches/${match.id}/finish`, 400, { baseVersion: done.version })

    const detail = (await owner.json<{ room: RoomDetail }>('GET', `/api/rooms/${room.id}`, 200)).room
    expect(detail.liveMatches).toHaveLength(0)
    expect(detail.recentMatches[0]).toMatchObject({ id: match.id, status: 'completed', active: null, awaitingConfirmation: false })
    expect(detail.recentMatches[0].players.map((p) => p.won)).toEqual([true, false])
    expect(detail.members.map((m) => [m.name, m.rating, m.matches])).toEqual([['Olivia', 1000, 0], ['Max', 1016, 1], ['Nora', 984, 1]])

    const rooms = (await max.json<{ rooms: { myRating: number; myRank: number | null; completedMatches: number }[] }>('GET', '/api/rooms', 200)).rooms
    expect(rooms[0]).toMatchObject({ myRating: 1016, myRank: 1, completedMatches: 1 })
    expect((await nora.json<{ rooms: { myRank: number | null }[] }>('GET', '/api/rooms', 200)).rooms[0].myRank).toBe(2)
    expect((await owner.json<{ rooms: { myRank: number | null }[] }>('GET', '/api/rooms', 200)).rooms[0].myRank).toBeNull()
  })

  it('does not rate guests or matches with fewer than two ranked players', async () => {
    const { owner, room } = await roomWithPlayers()
    let match = await createMatch(owner, room.id, [{ userId: owner.userId! }, { guestName: 'Guest' }])
    match = await finish(owner, await play(owner, match, CHECKOUT_101))
    expect(match.results!.map((r) => [r.ratingBefore, r.ratingAfter])).toEqual([[1000, 1000], [null, null]])
  })

  it('uses pairwise multi-player Elo', () => {
    expect(eloDeltas([1000, 1000], [1, 2])).toEqual([16, -16])
    expect(eloDeltas([1000, 1000, 1000], [1, 2, 3])).toEqual([16, 0, -16])
    expect(eloDeltas([1000, 1000], [1, 1])).toEqual([0, 0])
    const deltas = eloDeltas([1100, 1000, 950], [2, 1, 3])
    expect(deltas.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10)
    expect(deltas[1]).toBeGreaterThan(16)
  })
})

describe('deleting matches', () => {
  it('enforces permissions and recomputes ratings after deleting a completed match', async () => {
    const { ctx, owner, max, nora, room } = await roomWithPlayers()
    const live = await createMatch(max, room.id, players(max, nora))
    await nora.json('DELETE', `/api/matches/${live.id}`, 403)
    expect((await max.delete(`/api/matches/${live.id}`)).status).toBe(204)
    await max.json('GET', `/api/matches/${live.id}`, 404)

    const liveByNora = await createMatch(nora, room.id, players(max, nora))
    expect((await owner.delete(`/api/matches/${liveByNora.id}`)).status).toBe(204)

    const first = await finish(max, await play(max, await createMatch(max, room.id, players(max, nora)), CHECKOUT_101))
    ctx.clock.advance(60_000)
    const second = await finish(max, await play(max, await createMatch(max, room.id, players(max, nora)), CHECKOUT_101))
    expect(second.results!.map((r) => [r.ratingBefore, r.ratingAfter])).toEqual([[1016, 1031], [984, 969]])

    await max.json('DELETE', `/api/matches/${first.id}`, 403) // completed: owner only
    expect((await owner.delete(`/api/matches/${first.id}`)).status).toBe(204)
    const replayed = (await max.json<{ match: MatchDetail }>('GET', `/api/matches/${second.id}`, 200)).match
    expect(replayed.results!.map((r) => [r.ratingBefore, r.ratingAfter])).toEqual([[1000, 1016], [1000, 984]])
    const members = (await owner.json<{ room: RoomDetail }>('GET', `/api/rooms/${room.id}`, 200)).room.members
    expect(members.map((m) => [m.name, m.rating, m.matches])).toEqual([['Olivia', 1000, 0], ['Max', 1016, 1], ['Nora', 984, 1]])
  })
})
