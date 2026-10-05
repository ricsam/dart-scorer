import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveHub } from '../../server/live'
import { eloDeltas } from '../../server/ratings'
import type {
  CareerStatsResponse,
  ChatEvent,
  ChatResponse,
  InviteCandidatesResponse,
  InvitesResponse,
  LobbiesResponse,
  LobbyDetail,
  LobbyEvent,
  MatchDetail,
  MyMatchesResponse,
  RankingsResponse,
  UserEvent,
} from '../../src/shared/api'
import {
  act,
  CHECKOUT_101,
  Client,
  createLeague,
  createLobby,
  current,
  DEFAULTS_101,
  devLogin,
  finish,
  joinLeague,
  joinLobby,
  play,
  setup,
  SseReader,
  startLobby,
  type TestContext,
} from './helpers'

const MINUTE = 60 * 1000

async function lobbyOf(client: Client, lobbyId: string, code?: string) {
  return (await client.json<{ lobby: LobbyDetail }>('GET', `/api/lobbies/${lobbyId}${code ? `?code=${code}` : ''}`, 200)).lobby
}

async function chat(client: Client, path: string) {
  return (await client.json<ChatResponse>('GET', path, 200)).messages.map((message) => [message.kind, message.body])
}

let ctx: TestContext
beforeEach(() => {
  ctx = setup({ deps: { hub: new LiveHub(0) } })
})
afterEach(() => {
  ctx.app.services.bots.stop()
  ctx.app.services.hub.closeAll()
})

describe('lobbies', () => {
  it('plays a solo practice game from a private lobby and keeps it out of competition', async () => {
    const alice = await devLogin(ctx.app, 'Alice')
    expect(await alice.json('GET', '/api/lobbies/current', 200)).toEqual({ lobby: null })
    const lobby = await createLobby(alice)
    expect(lobby).toMatchObject({ visibility: 'private', ranked: false, capacity: 4, settings: DEFAULTS_101, role: 'leader', canJoin: false, match: null, lastMatch: null, invited: [] })
    expect(lobby.seats).toEqual([expect.objectContaining({ kind: 'user', userId: alice.userId, name: 'Alice', leader: true, rating: 1000, rankedMatches: 0 })])
    expect(lobby.inviteCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/)
    expect((await alice.json<{ lobby: LobbyDetail }>('GET', '/api/lobbies/current', 200)).lobby?.id).toBe(lobby.id)

    const match = await startLobby(alice, lobby)
    expect(match).toMatchObject({
      leagueId: null, leagueName: null, lobbyId: lobby.id, ranked: false, practice: true, forfeitSlot: null,
      canScore: true, controlledSlots: [0], canResetLeg: true, canConcede: false, claim: null, canDelete: true, canChat: true, autoSaveAt: null,
    })
    expect(match.players).toEqual([expect.objectContaining({ slot: 0, userId: alice.userId, name: 'Alice', guest: false })])
    await alice.json('POST', `/api/lobbies/${lobby.id}/start`, 400)
    expect((await lobbyOf(alice, lobby.id)).match).toMatchObject({ id: match.id, status: 'live', lobbyId: lobby.id })
    expect((await alice.json<MyMatchesResponse>('GET', '/api/me/matches?status=live', 200)).matches.map((item) => [item.id, item.leagueName])).toEqual([[match.id, null]])

    const won = await play(alice, match, 'T20 M M', '9 D16')
    expect(won.state.matchWinner).toBe(0)
    expect(won.autoSaveAt).toBe(new Date(Date.parse(won.updatedAt) + 2 * MINUTE).toISOString())
    const saved = await finish(alice, won)
    expect(saved).toMatchObject({ status: 'completed', practice: true, canScore: false, canDelete: true })
    expect(saved.results![0]).toMatchObject({ placing: 1, won: true, ratingBefore: null, ratingAfter: null })
    expect(saved.results![0].stats).toMatchObject({ darts: 5, points: 101 })

    const stats = await alice.json<CareerStatsResponse>('GET', '/api/me/stats', 200)
    expect(stats.totals.matches).toBe(0)
    expect(stats.training.totals).toMatchObject({ matches: 1, average: 101 / 5 * 3 })
    expect(stats.all.totals).toMatchObject({ matches: 1, average: 101 / 5 * 3 })
    expect(stats.trend).toEqual([{ matchId: match.id, at: saved.completedAt, average: 101 / 5 * 3, practice: true, ranked: false }])
    expect(stats.training.recentMatches.map((item) => [item.id, item.leagueName])).toEqual([[match.id, null]])
    expect(stats.global).toEqual({ rating: 1000, rank: null, matches: 0, wins: 0, losses: 0, history: [] })

    expect(await lobbyOf(alice, lobby.id)).toMatchObject({ match: null, lastMatch: { id: match.id, status: 'completed' } })
    expect(await chat(alice, `/api/lobbies/${lobby.id}/chat`)).toEqual([
      ['system', 'Alice started a solo game: 101 · double out · first to 1.'],
      ['system', 'Alice finished a 101 practice game.'],
    ])

    // Practice belongs to its owner, who may delete a mistaken game.
    await alice.json('DELETE', `/api/matches/${match.id}`, 204)
    expect((await alice.json<CareerStatsResponse>('GET', '/api/me/stats', 200)).training.totals.matches).toBe(0)
  })

  it('remembers the last format, keeps players in one lobby and hands over leadership', async () => {
    const alice = await devLogin(ctx.app, 'Alice')
    const bob = await devLogin(ctx.app, 'Bob')
    const carol = await devLogin(ctx.app, 'Carol')
    const first = await createLobby(alice)
    const format = { game: 301, doubleIn: true, doubleOut: true, legsToWin: 2 }
    await alice.json('PATCH', `/api/lobbies/${first.id}`, 200, { settings: format, capacity: 3 })
    // A new lobby replaces the old one (nobody else was in it) and reuses the format.
    const { lobby: second } = await alice.json<{ lobby: LobbyDetail }>('POST', '/api/lobbies', 201)
    expect(second).toMatchObject({ settings: format, capacity: 3, visibility: 'private', ranked: false })
    await alice.json('GET', `/api/lobbies/${first.id}`, 404)

    await joinLobby(bob, second, second.inviteCode)
    await joinLobby(carol, second, second.inviteCode)
    await alice.json('POST', `/api/lobbies/${second.id}/seats`, 400, { localName: 'Dad' }) // three seats taken
    await alice.json('PATCH', `/api/lobbies/${second.id}`, 400, { capacity: 2 })
    await alice.json('PATCH', `/api/lobbies/${second.id}`, 200, { capacity: 4 })
    await alice.json('POST', `/api/lobbies/${second.id}/seats`, 201, { localName: 'Dad' })
    await bob.json('PATCH', `/api/lobbies/${second.id}`, 403, { capacity: 5 })
    await bob.json('POST', `/api/lobbies/${second.id}/start`, 403)

    // Bob creates his own lobby: he leaves Alice's.
    const bobs = await createLobby(bob)
    expect((await lobbyOf(alice, second.id)).seats.map((seat) => seat.name)).toEqual(['Alice', 'Carol', 'Dad'])
    await bob.json('POST', `/api/lobbies/${bobs.id}/leave`, 204)
    await bob.json('GET', `/api/lobbies/${bobs.id}`, 404)

    // The leader leaves: the longest-seated player leads, and the leader's local players go too.
    await alice.json('POST', `/api/lobbies/${second.id}/leave`, 204)
    const handedOver = await lobbyOf(carol, second.id)
    expect(handedOver).toMatchObject({ role: 'leader', leader: { id: carol.userId } })
    expect(handedOver.seats.map((seat) => [seat.name, seat.leader])).toEqual([['Carol', true]])
    expect((await chat(carol, `/api/lobbies/${second.id}/chat`)).slice(-2)).toEqual([
      ['system', 'Alice left the lobby.'],
      ['system', 'Carol is now the lobby leader.'],
    ])
    await carol.json('POST', `/api/lobbies/${second.id}/leave`, 204)
    await carol.json('GET', `/api/lobbies/${second.id}`, 404)
    expect(ctx.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM lobbies')!.count).toBe(0)
  })

  it('protects private lobbies, lists public ones whose leader is online and enforces capacity', async () => {
    const alice = await devLogin(ctx.app, 'Alice')
    const bob = await devLogin(ctx.app, 'Bob')
    const carol = await devLogin(ctx.app, 'Carol')
    const lobby = await createLobby(alice, { capacity: 2 })
    await bob.json('GET', `/api/lobbies/${lobby.id}`, 404)
    await bob.json('GET', `/api/lobbies/${lobby.id}?code=WRONGCODE2`, 404)
    await bob.json('POST', `/api/lobbies/${lobby.id}/join`, 404, {})
    const preview = await lobbyOf(bob, lobby.id, lobby.inviteCode!.toLowerCase())
    expect(preview).toMatchObject({ role: 'visitor', canJoin: true, joinBlockedReason: null, inviteCode: null, invited: [] })
    const joined = await joinLobby(bob, lobby, lobby.inviteCode)
    expect(joined).toMatchObject({ role: 'member', inviteCode: lobby.inviteCode })
    expect(await bob.json('POST', `/api/lobbies/${lobby.id}/join`, 200, { code: lobby.inviteCode })).toMatchObject({ lobby: { role: 'member' } })
    expect(await carol.json('POST', `/api/lobbies/${lobby.id}/join`, 403, { code: lobby.inviteCode })).toMatchObject({ message: 'This lobby is full.' })

    // Public lobbies are listed while the leader is connected and seats remain.
    await alice.json('PATCH', `/api/lobbies/${lobby.id}`, 200, { visibility: 'public' })
    expect((await carol.json<LobbiesResponse>('GET', '/api/lobbies', 200)).lobbies).toEqual([])
    const stream = new SseReader(await alice.get(`/api/lobbies/${lobby.id}/events`))
    await stream.waitFor<LobbyEvent>('lobby')
    expect((await carol.json<LobbiesResponse>('GET', '/api/lobbies', 200)).lobbies).toEqual([]) // full
    await alice.json('PATCH', `/api/lobbies/${lobby.id}`, 200, { capacity: 3 })
    const listed = (await carol.json<LobbiesResponse>('GET', '/api/lobbies', 200)).lobbies
    expect(listed).toEqual([expect.objectContaining({ id: lobby.id, visibility: 'public', capacity: 3, playing: false, leader: expect.objectContaining({ name: 'Alice', rating: 1000 }) })])
    expect(listed[0].seats.map((seat) => seat.name)).toEqual(['Alice', 'Bob'])
    expect((await lobbyOf(carol, lobby.id)).seats.map((seat) => [seat.name, seat.online])).toEqual([['Alice', true], ['Bob', false]])
    await joinLobby(carol, lobby)
    // Seated players still see their own lobby; it is full for everyone else.
    expect((await carol.json<LobbiesResponse>('GET', '/api/lobbies', 200)).lobbies).toEqual([expect.objectContaining({ id: lobby.id })])
    const dan = await devLogin(ctx.app, 'Dan')
    expect((await dan.json<LobbiesResponse>('GET', '/api/lobbies', 200)).lobbies).toEqual([])
    expect(await lobbyOf(dan, lobby.id)).toMatchObject({ role: 'visitor', canJoin: false, joinBlockedReason: 'This lobby is full.' })
    await stream.cancel()

    // Guests from a league invite cannot use lobbies.
    const owner = await devLogin(ctx.app, 'Owner')
    const league = await createLeague(owner)
    const guest = new Client(ctx.app)
    await guest.json('POST', `/api/invites/${league.inviteCode}/guest`, 200, { name: 'Visitor' })
    expect(await guest.json('POST', '/api/lobbies', 403, {})).toMatchObject({ message: 'Sign in with Google to play in lobbies.' })
    await guest.json('GET', '/api/lobbies', 403)
  })

  it('seats bots and local players in unranked lobbies, with darts entered by the right device', async () => {
    const alice = await devLogin(ctx.app, 'Alice')
    const bob = await devLogin(ctx.app, 'Bob')
    const lobby = await createLobby(alice)
    await alice.json('POST', `/api/lobbies/${lobby.id}/seats`, 201, { botId: 'pub-pete' })
    await alice.json('POST', `/api/lobbies/${lobby.id}/seats`, 400, { botId: 'pub-pete' })
    await alice.json('POST', `/api/lobbies/${lobby.id}/seats`, 400, { botId: 'nobody' })
    await alice.json('POST', `/api/lobbies/${lobby.id}/seats`, 400, { localName: ' alice ' })
    await alice.json('POST', `/api/lobbies/${lobby.id}/seats`, 400, { botId: 'pub-pete', localName: 'Dad' })
    const seated = (await alice.json<{ lobby: LobbyDetail }>('POST', `/api/lobbies/${lobby.id}/seats`, 201, { localName: 'Dad' })).lobby
    expect(seated.seats.map((seat) => [seat.kind, seat.name, seat.rating])).toEqual([['user', 'Alice', 1000], ['bot', 'Pub Pete', null], ['local', 'Dad', null]])
    expect(await alice.json('PATCH', `/api/lobbies/${lobby.id}`, 400, { ranked: true })).toMatchObject({ message: 'Ranked games are between accounts only. Remove bots and local players first.' })

    await alice.json('POST', `/api/lobbies/${lobby.id}/order`, 400, { seatIds: [seated.seats[0].id] })
    await alice.json('POST', `/api/lobbies/${lobby.id}/order`, 200, { seatIds: [seated.seats[2].id, seated.seats[0].id, seated.seats[1].id] })
    const match = await startLobby(alice, lobby)
    expect(match.players.map((player) => [player.name, player.botId, player.guest])).toEqual([['Dad', null, true], ['Alice', null, false], ['Pub Pete', 'pub-pete', false]])
    expect(match).toMatchObject({ practice: true, ranked: false, controlledSlots: [0, 1], canResetLeg: true, canConcede: false, claim: null })
    expect((await lobbyOf(alice, lobby.id)).seats.map((seat) => seat.name)).toEqual(['Alice', 'Pub Pete', 'Dad'])
    await bob.json('GET', `/api/matches/${match.id}`, 404)

    // Alice enters darts for Dad on her device; the bot answers on the server.
    const afterDad = await act(alice, match, { type: 'submit', entry: 'T20 T20 T20' })
    expect(afterDad.state.active).toBe(1)
    await alice.json('POST', `/api/lobbies/${lobby.id}/start`, 400)
    // Unranked lobby games can be abandoned by the leader.
    await alice.json('DELETE', `/api/matches/${match.id}`, 204)
    expect(await lobbyOf(alice, lobby.id)).toMatchObject({ match: null, lastMatch: null })
  })
})

describe('ranked lobby matches', () => {
  it('lets players score only their own turns and rates the result globally', async () => {
    const alice = await devLogin(ctx.app, 'Alice')
    const bob = await devLogin(ctx.app, 'Bob')
    const carol = await devLogin(ctx.app, 'Carol')
    const lobby = await createLobby(alice, { ranked: true, capacity: 2 })
    expect(await alice.json('POST', `/api/lobbies/${lobby.id}/start`, 400)).toMatchObject({ message: expect.stringContaining('Ranked games need at least two players') })
    await alice.json('POST', `/api/lobbies/${lobby.id}/seats`, 400, { botId: 'pub-pete' })
    await joinLobby(bob, lobby, lobby.inviteCode)
    const match = await startLobby(alice, lobby)
    expect(match).toMatchObject({ ranked: true, practice: false, controlledSlots: [0], canResetLeg: false, canConcede: true, canDelete: false, claim: null })
    const bobView = await current(bob, match.id)
    expect(bobView).toMatchObject({ controlledSlots: [1], canConcede: true, canDelete: false, claim: { slot: 0, at: new Date(Date.parse(match.updatedAt) + 3 * MINUTE).toISOString() } })
    await carol.json('GET', `/api/matches/${match.id}`, 404) // private lobby game

    expect(await bob.json('POST', `/api/matches/${match.id}/actions`, 403, { action: { type: 'submit', entry: '60' }, baseVersion: match.version }))
      .toMatchObject({ message: "It's Alice's turn. They enter their own darts." })
    let state = await act(alice, match, { type: 'submit', entry: 'T20 M M' })
    expect(await bob.json('POST', `/api/matches/${match.id}/actions`, 403, { action: { type: 'undo' }, baseVersion: state.version }))
      .toMatchObject({ message: 'The last darts belong to Alice. Only they can undo them.' })
    await act(alice, state, { type: 'resetLeg' }, 403)
    state = await act(alice, state, { type: 'undo' })
    expect(state.state.currentVisit.map((dart) => dart.label)).toEqual(['T20', 'MISS'])
    state = await play(alice, state, 'M')
    state = await play(bob, state, 'M M M')
    state = await play(alice, state, '9 D16')
    expect(state.state.matchWinner).toBe(0)
    expect(state.claim).toBeNull()
    await bob.json('DELETE', `/api/matches/${match.id}`, 403)
    const saved = await finish(bob, await current(bob, match.id))
    expect(saved.results!.map((result) => [result.placing, result.won, result.ratingBefore, result.ratingAfter])).toEqual([[1, true, 1000, 1016], [2, false, 1000, 984]])

    const rankings = await carol.json<RankingsResponse>('GET', '/api/rankings', 200)
    expect(rankings.entries.map((entry) => [entry.rank, entry.name, entry.rating, entry.matches, entry.wins, entry.losses])).toEqual([[1, 'Alice', 1016, 1, 1, 0], [2, 'Bob', 984, 1, 0, 1]])
    expect(rankings).toMatchObject({ me: null, totalPlayers: 2 })
    expect(rankings.entries[0].average).toBeCloseTo(101 / 5 * 3)
    expect((await bob.json<RankingsResponse>('GET', '/api/rankings', 200)).me).toMatchObject({ rank: 2, rating: 984 })
    const career = await alice.json<CareerStatsResponse>('GET', '/api/me/stats', 200)
    expect(career.global).toEqual({ rating: 1016, rank: 1, matches: 1, wins: 1, losses: 0, history: [{ at: saved.completedAt, rating: 1016 }] })
    expect(career.totals).toMatchObject({ matches: 1, wins: 1, losses: 0 })
    expect(career.recentMatches.map((item) => [item.id, item.ranked])).toEqual([[match.id, true]])
    expect((await lobbyOf(alice, lobby.id)).seats.map((seat) => [seat.name, seat.rating, seat.rankedMatches])).toEqual([['Bob', 984, 1], ['Alice', 1016, 1]])

    // Game two: Bob throws first and concedes. The result is rated like any other.
    const second = await startLobby(alice, lobby)
    expect(second.players.map((player) => player.name)).toEqual(['Bob', 'Alice'])
    const conceded = (await bob.json<{ match: MatchDetail }>('POST', `/api/matches/${second.id}/forfeit`, 200, { baseVersion: second.version, slot: 0 })).match
    expect(conceded).toMatchObject({ status: 'completed', forfeitSlot: 0 })
    const [aliceGain] = eloDeltas([1016, 984], [1, 2])
    expect(conceded.results!.map((result) => [result.placing, result.won])).toEqual([[2, false], [1, true]])
    expect(conceded.results![1].ratingAfter).toBe(Math.round(1016 + aliceGain))

    // Game three: Alice goes quiet at the oche; Bob may claim the match after three minutes.
    const third = await startLobby(alice, lobby)
    expect(third.players.map((player) => player.name)).toEqual(['Alice', 'Bob'])
    await bob.json('POST', `/api/matches/${third.id}/forfeit`, 409, { baseVersion: third.version - 1, slot: 0 })
    expect(await bob.json('POST', `/api/matches/${third.id}/forfeit`, 400, { baseVersion: third.version, slot: 0 }))
      .toMatchObject({ message: 'Alice still has time to throw. You can claim the match after three minutes without activity.' })
    await bob.json('POST', `/api/matches/${third.id}/forfeit`, 403, { baseVersion: third.version, slot: 5 }).catch(() => undefined)
    ctx.clock.advance(3 * MINUTE)
    const claimed = (await bob.json<{ match: MatchDetail }>('POST', `/api/matches/${third.id}/forfeit`, 200, { baseVersion: third.version, slot: 0 })).match
    expect(claimed).toMatchObject({ status: 'completed', forfeitSlot: 0 })
    expect(claimed.results!.map((result) => [result.placing, result.won])).toEqual([[2, false], [1, true]])
    expect((await chat(alice, `/api/lobbies/${lobby.id}/chat`)).filter(([kind]) => kind === 'system').slice(-3)).toEqual([
      ['system', 'Bob conceded · Alice wins (legs 0–0).'],
      ['system', 'Alice started a ranked game: 101 · double out · first to 1.'],
      ['system', 'Alice timed out · Bob wins (legs 0–0).'],
    ])
    expect((await alice.json<CareerStatsResponse>('GET', '/api/me/stats', 200)).global).toMatchObject({ matches: 3, wins: 2, losses: 1 })
  })

  it('cannot claim during your own turn, a decided match or in practice; concede is for account duels', async () => {
    const alice = await devLogin(ctx.app, 'Alice')
    const bob = await devLogin(ctx.app, 'Bob')
    const lobby = await createLobby(alice)
    await joinLobby(bob, lobby, lobby.inviteCode)
    const match = await startLobby(alice, lobby)
    expect(match).toMatchObject({ ranked: false, practice: false, canConcede: true, canDelete: true })
    ctx.clock.advance(5 * MINUTE)
    await alice.json('POST', `/api/matches/${match.id}/forfeit`, 403, { baseVersion: match.version, slot: 1 }) // Alice is at the oche
    const won = await play(alice, match, CHECKOUT_101)
    ctx.clock.advance(5 * MINUTE)
    expect(await bob.json('POST', `/api/matches/${won.id}/forfeit`, 403, { baseVersion: won.version, slot: 0 })).toMatchObject({ message: 'The match is already decided. Save the result instead.' })

    const solo = await devLogin(ctx.app, 'Solo')
    const practice = await startLobby(solo, await createLobby(solo))
    await solo.json('POST', `/api/matches/${practice.id}/forfeit`, 403, { baseVersion: practice.version, slot: 0 })
  })
})

describe('lobby invites', () => {
  it('invites people you know, lifts removals and lets invitees decline', async () => {
    const alice = await devLogin(ctx.app, 'Alice')
    const dave = await devLogin(ctx.app, 'Dave')
    const fay = await devLogin(ctx.app, 'Fay')
    const eve = await devLogin(ctx.app, 'Eve')
    const league = await createLeague(alice, 'Pub league')
    await joinLeague(dave, league.inviteCode)
    await joinLeague(fay, league.inviteCode)
    const lobby = await createLobby(alice)

    const { candidates } = await alice.json<InviteCandidatesResponse>('GET', `/api/lobbies/${lobby.id}/invite-candidates`, 200)
    expect(candidates.map((candidate) => [candidate.name, candidate.via, candidate.invited, candidate.member])).toEqual([['Dave', 'Pub league', false, false], ['Fay', 'Pub league', false, false]])
    await dave.json('GET', `/api/lobbies/${lobby.id}/invite-candidates`, 404)
    expect(await alice.json('POST', `/api/lobbies/${lobby.id}/invites`, 403, { userId: eve.userId })).toMatchObject({ message: expect.stringContaining('league members and players you have played with') })

    const daveStream = new SseReader(await dave.get('/api/me/events'))
    await daveStream.waitFor('ready')
    const invited = (await alice.json<{ lobby: LobbyDetail }>('POST', `/api/lobbies/${lobby.id}/invites`, 201, { userId: dave.userId })).lobby
    expect(invited.invited.map((user) => user.name)).toEqual(['Dave'])
    expect(await daveStream.waitFor<UserEvent>('user')).toMatchObject({ type: 'invite', invite: { lobby: { id: lobby.id }, invitedBy: { name: 'Alice' } } })
    expect((await dave.json<InvitesResponse>('GET', '/api/me/invites', 200)).invites.map((invite) => invite.lobby.id)).toEqual([lobby.id])
    expect(await lobbyOf(dave, lobby.id)).toMatchObject({ role: 'visitor', canJoin: true })
    await joinLobby(dave, lobby)
    expect((await dave.json<InvitesResponse>('GET', '/api/me/invites', 200)).invites).toEqual([])
    expect(await daveStream.waitFor<UserEvent>('user')).toEqual({ type: 'invite-removed', lobbyId: lobby.id })
    await daveStream.cancel()

    // Removed players cannot come back by link, until the leader invites them again.
    const seat = (await lobbyOf(alice, lobby.id)).seats.find((item) => item.userId === dave.userId)!
    await dave.json('DELETE', `/api/lobbies/${lobby.id}/seats/${(await lobbyOf(alice, lobby.id)).seats[0].id}`, 403)
    await alice.json('DELETE', `/api/lobbies/${lobby.id}/seats/${seat.id}`, 204)
    expect(await dave.json('POST', `/api/lobbies/${lobby.id}/join`, 403, { code: lobby.inviteCode })).toMatchObject({ message: 'The leader removed you from this lobby.' })
    await alice.json('POST', `/api/lobbies/${lobby.id}/invites`, 201, { userId: dave.userId })
    await joinLobby(dave, lobby)

    await alice.json('POST', `/api/lobbies/${lobby.id}/invites`, 201, { userId: fay.userId })
    await fay.json('DELETE', `/api/me/invites/${lobby.id}`, 204)
    expect((await lobbyOf(alice, lobby.id)).invited).toEqual([])
    await fay.json('GET', `/api/lobbies/${lobby.id}`, 404)

    // Invites expire after an hour.
    await alice.json('POST', `/api/lobbies/${lobby.id}/invites`, 201, { userId: fay.userId })
    ctx.clock.advance(61 * MINUTE)
    expect((await fay.json<InvitesResponse>('GET', '/api/me/invites', 200)).invites).toEqual([])

    // A rotated code stops the old link.
    const rotated = (await alice.json<{ lobby: LobbyDetail }>('POST', `/api/lobbies/${lobby.id}/invite-code`, 200)).lobby
    expect(rotated.inviteCode).not.toBe(lobby.inviteCode)
    await eve.json('GET', `/api/lobbies/${lobby.id}?code=${lobby.inviteCode}`, 404)
  })

  it('suggests earlier lobby opponents', async () => {
    const alice = await devLogin(ctx.app, 'Alice')
    const bob = await devLogin(ctx.app, 'Bob')
    const lobby = await createLobby(alice)
    await joinLobby(bob, lobby, lobby.inviteCode)
    await startLobby(alice, lobby)
    await bob.json('POST', `/api/lobbies/${lobby.id}/leave`, 204)
    const { candidates } = await alice.json<InviteCandidatesResponse>('GET', `/api/lobbies/${lobby.id}/invite-candidates`, 200)
    expect(candidates.map((candidate) => [candidate.name, candidate.via])).toEqual([['Bob', 'Played together']])
  })
})

describe('lobby and match chat', () => {
  it('shares lobby chat with its games and keeps spectators out', async () => {
    const alice = await devLogin(ctx.app, 'Alice')
    const bob = await devLogin(ctx.app, 'Bob')
    const carol = await devLogin(ctx.app, 'Carol')
    const lobby = await createLobby(alice, { visibility: 'public' })
    await joinLobby(bob, lobby)
    const bobStream = new SseReader(await bob.get(`/api/lobbies/${lobby.id}/events`))
    await bobStream.waitFor<LobbyEvent>('lobby')

    await alice.json('POST', `/api/lobbies/${lobby.id}/chat`, 400, { body: '   ' })
    await alice.json('POST', `/api/lobbies/${lobby.id}/chat`, 400, { body: 'x'.repeat(281) })
    await carol.json('POST', `/api/lobbies/${lobby.id}/chat`, 404, { body: 'Hi!' })
    await carol.json('GET', `/api/lobbies/${lobby.id}/chat`, 404)
    const { message } = await alice.json('POST', `/api/lobbies/${lobby.id}/chat`, 201, { body: '  Good darts!  ' })
    expect(message).toMatchObject({ kind: 'text', body: 'Good darts!', user: { id: alice.userId, name: 'Alice' } })
    expect((await bobStream.waitFor<ChatEvent>('chat', (event) => event.message.kind === 'text')).message.body).toBe('Good darts!')

    const match = await startLobby(alice, lobby)
    expect(await bobStream.waitFor<LobbyEvent>('lobby', (event) => event.type === 'started')).toEqual({ type: 'started', matchId: match.id })
    const bobMatch = new SseReader(await bob.get(`/api/matches/${match.id}/events`))
    await bobMatch.waitFor('match')
    // Anyone signed in may watch a public lobby's game, but not read its chat.
    const spectator = await current(carol, match.id)
    expect(spectator).toMatchObject({ canScore: false, canChat: false, controlledSlots: [] })
    await carol.json('GET', `/api/matches/${match.id}/chat`, 403)
    const carolMatch = new SseReader(await carol.get(`/api/matches/${match.id}/events`))
    await carolMatch.waitFor('match')

    await bob.json('POST', `/api/matches/${match.id}/chat`, 201, { body: 'Game on' })
    expect((await bobMatch.waitFor<ChatEvent>('chat', (event) => event.message.kind === 'text')).message.body).toBe('Game on')
    expect((await chat(alice, `/api/matches/${match.id}/chat`)).filter(([kind]) => kind === 'text')).toEqual([['text', 'Good darts!'], ['text', 'Game on']])
    expect(await carolMatch.drain()).not.toContain('chat')

    // Starting the next game pulls players from the finished one into it.
    const won = await play(alice, await current(alice, match.id), CHECKOUT_101)
    await finish(bob, won)
    const next = await startLobby(alice, lobby)
    expect(await bobMatch.waitFor<LobbyEvent>('lobby', (event) => event.type === 'started')).toEqual({ type: 'started', matchId: next.id })
    for (const stream of [bobStream, bobMatch, carolMatch]) await stream.cancel()
  })

  it('gives league matches their own chat for league members, with a rate limit', async () => {
    ctx = setup({ deps: { hub: new LiveHub(0) }, limits: { chatPerMinute: 2 } })
    const owner = await devLogin(ctx.app, 'Olivia')
    const max = await devLogin(ctx.app, 'Max')
    const outsider = await devLogin(ctx.app, 'Otto')
    const league = await createLeague(owner)
    await joinLeague(max, league.inviteCode)
    const { match } = await owner.json<{ match: MatchDetail }>('POST', `/api/leagues/${league.id}/matches`, 201, { players: [{ userId: owner.userId }, { userId: max.userId }], settings: DEFAULTS_101 })
    expect(match).toMatchObject({ canChat: true, lobbyId: null, leagueName: 'Tuesday League' })
    await max.json('POST', `/api/matches/${match.id}/chat`, 201, { body: 'Nice 180' })
    await max.json('POST', `/api/matches/${match.id}/chat`, 201, { body: 'Again!' })
    await max.json('POST', `/api/matches/${match.id}/chat`, 429, { body: 'Too much' })
    expect(await chat(owner, `/api/matches/${match.id}/chat`)).toEqual([['text', 'Nice 180'], ['text', 'Again!']])
    await outsider.json('GET', `/api/matches/${match.id}/chat`, 404)
    ctx.clock.advance(MINUTE)
    await max.json('POST', `/api/matches/${match.id}/chat`, 201, { body: 'Back' })
  })
})

describe('lobby streams and housekeeping', () => {
  it('tells removed players and closes the lobby stream', async () => {
    const alice = await devLogin(ctx.app, 'Alice')
    const bob = await devLogin(ctx.app, 'Bob')
    const lobby = await createLobby(alice)
    await joinLobby(bob, lobby, lobby.inviteCode)
    const stream = new SseReader(await bob.get(`/api/lobbies/${lobby.id}/events`))
    expect(await stream.waitFor<LobbyEvent>('lobby')).toMatchObject({ type: 'lobby', lobby: { role: 'member' } })
    const seat = (await lobbyOf(alice, lobby.id)).seats[1]
    await alice.json('DELETE', `/api/lobbies/${lobby.id}/seats/${seat.id}`, 204)
    expect(await stream.waitFor<LobbyEvent>('lobby', (event) => event.type === 'removed')).toEqual({ type: 'removed' })
    let frame = await stream.next()
    while (frame) frame = await stream.next()
    await bob.json('GET', `/api/lobbies/${lobby.id}/events`, 404)
  })

  it('auto-saves decided lobby games, expires invites and closes idle lobbies', async () => {
    const alice = await devLogin(ctx.app, 'Alice')
    const bob = await devLogin(ctx.app, 'Bob')
    const lobby = await createLobby(alice)
    await joinLobby(bob, lobby, lobby.inviteCode)
    const won = await play(alice, await startLobby(alice, lobby), CHECKOUT_101)
    ctx.clock.advance(MINUTE)
    ctx.app.services.janitor.sweep()
    expect((await current(alice, won.id)).status).toBe('live')
    ctx.clock.advance(MINUTE)
    ctx.app.services.janitor.sweep()
    const saved = await current(alice, won.id)
    expect(saved).toMatchObject({ status: 'completed', results: [expect.objectContaining({ won: true }), expect.objectContaining({ won: false })] })
    expect((await chat(alice, `/api/lobbies/${lobby.id}/chat`)).at(-1)).toEqual(['system', 'Alice won 1–0 · saved automatically.'])

    // A lobby with a live game stays; an idle lobby nobody is connected to closes.
    const busy = await createLobby(bob)
    await startLobby(bob, busy)
    ctx.clock.advance(31 * MINUTE)
    ctx.app.services.janitor.sweep()
    await alice.json('GET', `/api/lobbies/${lobby.id}`, 404)
    expect(await lobbyOf(bob, busy.id)).toMatchObject({ match: expect.objectContaining({ status: 'live' }) })
  })

  it('keeps lobbies with someone connected', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const alice = await devLogin(ctx.app, 'Alice')
      const lobby = await createLobby(alice)
      const stream = new SseReader(await alice.get(`/api/lobbies/${lobby.id}/events`))
      await stream.waitFor('lobby')
      ctx.clock.advance(40 * MINUTE)
      ctx.app.services.janitor.sweep()
      expect(await lobbyOf(alice, lobby.id)).toMatchObject({ id: lobby.id })
      await stream.cancel()
    } finally {
      vi.useRealTimers()
    }
  })
})
