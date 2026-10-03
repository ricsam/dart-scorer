import { describe, expect, it } from 'vitest'
import type {
  CareerStatsResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  MatchDetail,
  MatchesResponse,
  PlayerRoomStatsResponse,
} from '../../src/shared/api'
import { resultsHistory } from '../../server/stats'
import type { ResultRow } from '../../server/data'
import { CHECKOUT_101, Client, createMatch, createRoom, devLogin, finish, joinRoom, play, setup } from './helpers'

/**
 * Olivia owns the room; Max and Nora play three matches; Zed never plays.
 *   m1 (20 days ago): Max beats Nora            → Max 1016, Nora 984
 *   m2 (3 days ago):  Nora beats Max            → Nora 1001.47, Max 998.53
 *   m3 (1 day ago):   Max beats Nora and a guest → Max 1014.67, Nora 985.33
 */
async function league() {
  const ctx = setup()
  const olivia = await devLogin(ctx.app, 'Olivia')
  const max = await devLogin(ctx.app, 'Max')
  const nora = await devLogin(ctx.app, 'Nora')
  const zed = await devLogin(ctx.app, 'Zed')
  const outsider = await devLogin(ctx.app, 'Otto')
  const room = await createRoom(olivia, 'League')
  for (const client of [max, nora, zed]) await joinRoom(client, room.inviteCode)

  const m1 = await finish(max, await play(max, await createMatch(olivia, room.id, [{ userId: max.userId! }, { userId: nora.userId! }]), CHECKOUT_101))
  ctx.clock.advanceDays(17)
  const m2 = await finish(nora, await play(nora, await createMatch(nora, room.id, [{ userId: nora.userId! }, { userId: max.userId! }]), 'T20 M M', 'M M M', '9 D16'))
  ctx.clock.advanceDays(2)
  const m3 = await finish(max, await play(max, await createMatch(max, room.id, [{ userId: max.userId! }, { userId: nora.userId! }, { guestName: 'Guest' }]), CHECKOUT_101))
  ctx.clock.advanceDays(1)
  return { ctx, olivia, max, nora, zed, outsider, room, m1, m2, m3 }
}

const byName = (entries: LeaderboardEntry[], name: string) => entries.find((entry) => entry.name === name)!

describe('leaderboard', () => {
  it('aggregates every current member for the selected period', async () => {
    const { olivia, outsider, room, m1, m2, m3 } = await league()
    const all = await olivia.json<LeaderboardResponse>('GET', `/api/rooms/${room.id}/leaderboard`, 200)
    expect(all.period).toBe('all')
    expect(all.entries.map((entry) => [entry.name, entry.rating])).toEqual([['Max', 1015], ['Olivia', 1000], ['Zed', 1000], ['Nora', 985]])

    const max = byName(all.entries, 'Max')
    expect(max).toMatchObject({
      ratingChange: 16, // 999 → 1015
      matches: 3,
      wins: 2,
      losses: 1,
      legsWon: 2,
      legsPlayed: 3,
      checkouts: 2,
      checkoutAttempts: 2,
      checkoutRate: 1,
      highestCheckout: 101,
      bestLegDarts: 3,
      scores180: 0,
      scores140: 0,
      scores100: 2, // both 101 checkouts are ton visits
      form: ['W', 'L', 'W'],
      lastPlayedAt: m3.completedAt,
    })
    expect(max.winRate).toBeCloseTo(2 / 3)
    expect(max.average).toBeCloseTo((202 / 9) * 3)
    expect(max.first9Average).toBeCloseTo((202 / 9) * 3)
    expect(byName(all.entries, 'Nora')).toMatchObject({ ratingChange: -16, matches: 3, wins: 1, losses: 2, form: ['L', 'W', 'L'] })
    expect(byName(all.entries, 'Zed')).toEqual({
      id: expect.any(String),
      name: 'Zed',
      avatarUrl: null,
      rating: 1000,
      ratingChange: null,
      matches: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      legsWon: 0,
      legsPlayed: 0,
      average: null,
      first9Average: null,
      checkoutRate: null,
      checkouts: 0,
      checkoutAttempts: 0,
      highestCheckout: 0,
      bestLegDarts: null,
      scores180: 0,
      scores140: 0,
      scores100: 0,
      form: [],
      lastPlayedAt: null,
    })

    const week = await olivia.json<LeaderboardResponse>('GET', `/api/rooms/${room.id}/leaderboard?period=7d`, 200)
    expect(week.period).toBe('7d')
    expect(byName(week.entries, 'Max')).toMatchObject({ rating: 1015, matches: 2, wins: 1, losses: 1, form: ['W', 'L'] })
    expect(byName(week.entries, 'Nora')).toMatchObject({ rating: 985, matches: 2, wins: 1, form: ['L', 'W'], lastPlayedAt: m3.completedAt })

    const month = await olivia.json<LeaderboardResponse>('GET', `/api/rooms/${room.id}/leaderboard?period=30d`, 200)
    expect(byName(month.entries, 'Max').matches).toBe(3)
    expect([m1, m2].every((match) => match.completedAt !== null)).toBe(true)

    await olivia.json('GET', `/api/rooms/${room.id}/leaderboard?period=year`, 400)
    await outsider.json('GET', `/api/rooms/${room.id}/leaderboard`, 404)
  })

  it('keeps form to the five most recent results', async () => {
    const ctx = setup()
    const a = await devLogin(ctx.app, 'A')
    const b = await devLogin(ctx.app, 'B')
    const room = await createRoom(a)
    await joinRoom(b, room.inviteCode)
    for (let i = 0; i < 6; i += 1) {
      const winner = i === 5 ? b : a
      const loser = winner === a ? b : a
      await finish(winner, await play(winner, await createMatch(a, room.id, [{ userId: winner.userId! }, { userId: loser.userId! }]), CHECKOUT_101))
      ctx.clock.advance(1000)
    }
    const { entries } = await a.json<LeaderboardResponse>('GET', `/api/rooms/${room.id}/leaderboard`, 200)
    expect(byName(entries, 'A').form).toEqual(['L', 'W', 'W', 'W', 'W'])
    expect(byName(entries, 'A').matches).toBe(6)
  })
})

describe('player statistics', () => {
  it('returns entry, rating history, head-to-head and recent matches', async () => {
    const { olivia, max, zed, outsider, room, m1, m2, m3 } = await league()
    const stats = await olivia.json<PlayerRoomStatsResponse>('GET', `/api/rooms/${room.id}/players/${max.userId}`, 200)
    expect(stats.player).toMatchObject({ id: max.userId, name: 'Max', role: 'member', rating: 1015, matches: 3 })
    expect(stats.entry).toMatchObject({ id: max.userId, matches: 3, wins: 2, rating: 1015 })
    expect(stats.ratingHistory).toEqual([
      { at: m1.completedAt, rating: 1016 },
      { at: m2.completedAt, rating: 999 },
      { at: m3.completedAt, rating: 1015 },
    ])
    expect(stats.history).toEqual([{ at: `${m1.completedAt!.slice(0, 7)}-01T00:00:00.000Z`, average: (202 / 9) * 3, matches: 3 }])
    expect(stats.training).toMatchObject({ totals: { matches: 0, average: null }, history: [], recentMatches: [] })
    expect(stats.headToHead).toEqual([{ opponent: { id: expect.any(String), name: 'Nora', avatarUrl: null }, wins: 2, losses: 1 }])
    expect(stats.recentMatches.map((match) => match.id)).toEqual([m3.id, m2.id, m1.id])
    expect(stats.recentMatches[0].players.map((p) => [p.name, p.won, p.guest])).toEqual([['Max', true, false], ['Nora', false, false], ['Guest', false, true]])

    const idle = await max.json<PlayerRoomStatsResponse>('GET', `/api/rooms/${room.id}/players/${zed.userId}`, 200)
    expect(idle).toMatchObject({ ratingHistory: [], headToHead: [], recentMatches: [], entry: { matches: 0, rating: 1000 } })

    await olivia.json('GET', `/api/rooms/${room.id}/players/${outsider.userId}`, 404)
    await outsider.json('GET', `/api/rooms/${room.id}/players/${max.userId}`, 404)
  })

  it('paginates completed matches newest first', async () => {
    const { olivia, room, m1, m2, m3 } = await league()
    const page = await olivia.json<MatchesResponse>('GET', `/api/rooms/${room.id}/matches?limit=2`, 200)
    expect(page.matches.map((match) => match.id)).toEqual([m3.id, m2.id])
    expect(page.hasMore).toBe(true)
    const next = await olivia.json<MatchesResponse>('GET', `/api/rooms/${room.id}/matches?limit=2&before=${encodeURIComponent(m2.completedAt!)}`, 200)
    expect(next.matches.map((match) => match.id)).toEqual([m1.id])
    expect(next.hasMore).toBe(false)
    expect((await olivia.json<MatchesResponse>('GET', `/api/rooms/${room.id}/matches`, 200)).matches).toHaveLength(3)
    await olivia.json('GET', `/api/rooms/${room.id}/matches?limit=0`, 400)
    await olivia.json('GET', `/api/rooms/${room.id}/matches?limit=51`, 400)
    await olivia.json('GET', `/api/rooms/${room.id}/matches?limit=abc`, 400)
    await olivia.json('GET', `/api/rooms/${room.id}/matches?before=yesterday`, 400)
  })
})

describe('training and progress', () => {
  it('buckets UTC months oldest first with dart-weighted averages and null for no darts', () => {
    const row = (completed_at: string, points: number, darts: number) => ({ completed_at, points, darts }) as ResultRow
    expect(resultsHistory([
      row('2026-03-01T00:00:00Z', 0, 0),
      row('2026-02-01T00:30:00+01:00', 90, 3),
      row('2026-01-15T12:00:00Z', 30, 9),
      row('2026-02-10T00:00:00Z', 60, 3),
    ])).toEqual([
      { at: '2026-01-01T00:00:00.000Z', average: 30, matches: 2 },
      { at: '2026-02-01T00:00:00.000Z', average: 60, matches: 1 },
      { at: '2026-03-01T00:00:00.000Z', average: null, matches: 1 },
    ])
  })

  it('classifies historical stored bot participants without rewriting results; recomputes on deletion and protects left rooms', async () => {
    const ctx = setup()
    const owner = await devLogin(ctx.app, 'Owner')
    const human = await devLogin(ctx.app, 'Human')
    const room = await createRoom(owner)
    await joinRoom(human, room.inviteCode)
    const roster = [{ userId: human.userId! }, { userId: owner.userId! }, { guestName: 'Historical bot' }]
    const first = await finish(human, await play(human, await createMatch(owner, room.id, roster), CHECKOUT_101))
    const second = await finish(human, await play(human, await createMatch(owner, room.id, roster), 'T20 M M', 'M M M', 'M M M', '9 D16'))
    // Simulate already-persisted historical bot games, even with stale rating fields.
    for (const match of [first, second]) {
      ctx.db.run("UPDATE match_players SET guest_id = NULL, bot_id = 'the-maximum' WHERE match_id = ? AND slot = 2", match.id)
      ctx.db.run("UPDATE match_results SET completed_at = '2025-01-15T12:00:00.000Z' WHERE match_id = ?", match.id)
    }
    const career = await human.json<CareerStatsResponse>('GET', '/api/me/stats', 200)
    expect(career.totals.matches).toBe(0)
    expect(career.history).toEqual([])
    expect(career.recentMatches).toEqual([])
    expect(career.training.totals.average).toBeCloseTo(202 / 8 * 3)
    expect(career.training.history).toEqual([{ at: '2025-01-01T00:00:00.000Z', average: 202 / 8 * 3, matches: 2 }])
    const player = await human.json<PlayerRoomStatsResponse>('GET', `/api/rooms/${room.id}/players/${human.userId}`, 200)
    expect(player).toMatchObject({ entry: { matches: 0, form: [] }, history: [], ratingHistory: [], headToHead: [], recentMatches: [] })
    expect(player.training.history).toEqual(career.training.history)
    await owner.json('DELETE', `/api/matches/${second.id}`, 204)
    const after = await human.json<CareerStatsResponse>('GET', '/api/me/stats', 200)
    expect(after.training.totals).toMatchObject({ matches: 1, average: 101 })
    expect(after.training.history).toEqual([{ at: '2025-01-01T00:00:00.000Z', average: 101, matches: 1 }])
    await human.json('DELETE', `/api/rooms/${room.id}/members/${human.userId}`, 204)
    const left = await human.json<CareerStatsResponse>('GET', '/api/me/stats', 200)
    expect(left.training.totals.matches).toBe(1)
    expect(left.training.history).toEqual(after.training.history)
    expect(left.training.recentMatches).toEqual([])
    await human.json('GET', `/api/matches/${first.id}`, 404)
    await owner.json('DELETE', `/api/matches/${first.id}`, 204)
    const empty = await human.json<CareerStatsResponse>('GET', '/api/me/stats', 200)
    expect(empty.training).toMatchObject({ totals: { matches: 0, average: null }, history: [], recentMatches: [] })
  })
})

describe('career statistics', () => {
  it('totals every result and lists current rooms and visible recent matches', async () => {
    const { ctx, olivia, max, room } = await league()
    const other = await createRoom(olivia, 'Office')
    await joinRoom(max, other.inviteCode)
    const office = await finish(olivia, await play(olivia, await createMatch(olivia, other.id, [{ userId: olivia.userId! }, { userId: max.userId! }]), CHECKOUT_101))

    const career = await max.json<CareerStatsResponse>('GET', '/api/me/stats', 200)
    expect(career.user).toMatchObject({ id: max.userId, name: 'Max' })
    expect(career.totals).toMatchObject({ matches: 4, wins: 2, losses: 2, legsWon: 2, legsPlayed: 4, lastPlayedAt: office.completedAt })
    expect(career.totals.winRate).toBe(0.5)
    expect(career.rooms).toEqual([
      { id: room.id, name: 'League', rating: 1015, rank: 1, matches: 3 },
      { id: other.id, name: 'Office', rating: 984, rank: 2, matches: 1 },
    ])
    expect(career.recentMatches.map((match) => [match.roomName, match.id === office.id])).toEqual([
      ['Office', true], ['League', false], ['League', false], ['League', false],
    ])

    // After leaving, the room and its matches disappear but the user's own totals remain.
    await max.json('DELETE', `/api/rooms/${other.id}/members/${max.userId}`, 204)
    const after = await max.json<CareerStatsResponse>('GET', '/api/me/stats', 200)
    expect(after.totals.matches).toBe(4)
    expect(after.rooms.map((r) => r.name)).toEqual(['League'])
    expect(after.recentMatches.every((match) => match.roomName === 'League')).toBe(true)

    const fresh = await devLogin(ctx.app, 'Fresh')
    const empty = await fresh.json<CareerStatsResponse>('GET', '/api/me/stats', 200)
    expect(empty).toMatchObject({ rooms: [], recentMatches: [], totals: { matches: 0, winRate: null, average: null } })
    await new Client(ctx.app).json('GET', '/api/me/stats', 401)
  })

  it('exposes finished match stats on the match itself', async () => {
    const { olivia, m3 } = await league()
    const { match } = await olivia.json<{ match: MatchDetail }>('GET', `/api/matches/${m3.id}`, 200)
    expect(match.results!.map((r) => [r.placing, r.won, r.ratingBefore, r.ratingAfter])).toEqual([
      [1, true, 999, 1015],
      [2, false, 1001, 985],
      [2, false, null, null],
    ])
  })
})
