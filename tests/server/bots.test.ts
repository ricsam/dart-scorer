import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createApp } from '../../server/app'
import { BOT_DART_DELAY_MS } from '../../server/bots'
import { Db, migrate, SCHEMA_VERSION } from '../../server/db'
import { getBot } from '../../src/shared/bots'
import type { CreateMatchRequest, MatchDetail, MatchResponse, MatchSettings } from '../../src/shared/api'
import { act, CHECKOUT_101, Client, createMatch, createLeague, DEFAULTS_101, devLogin, finish, joinLeague, play, setup, type TestContext } from './helpers'

let ctx: TestContext
beforeEach(() => {
  vi.useFakeTimers()
  ctx = setup({ deps: { botRandom: () => 0 } }) // intended targets always hit
})
afterEach(() => {
  ctx.app.services.bots.stop()
  ctx.app.services.hub.closeAll()
  ctx.db.close()
  vi.useRealTimers()
})

async function fixture(botFirst = false, settings: MatchSettings = { ...DEFAULTS_101, game: 501 }, extra: CreateMatchRequest['players'] = []) {
  const owner = await devLogin(ctx.app, 'Alex')
  const league = await createLeague(owner)
  const human = { userId: owner.userId! }
  const bot = { botId: 'the-maximum' }
  const players = botFirst ? [bot, ...extra, human] : [human, bot, ...extra]
  const { match } = await owner.json<MatchResponse>('POST', `/api/leagues/${league.id}/matches`, 201, { players, settings })
  return { owner, league, match }
}
async function current(client: Client, id: string) {
  return (await client.json<MatchResponse>('GET', `/api/matches/${id}`, 200)).match
}
const tick = (darts = 1) => vi.advanceTimersByTimeAsync(BOT_DART_DELAY_MS * darts)

async function event(reader: ReadableStreamDefaultReader<Uint8Array>, name: string) {
  let text = ''
  while (!text.includes(`event: ${name}\n`)) text += new TextDecoder().decode((await reader.read()).value)
  return JSON.parse(text.split('data: ')[1].split('\n')[0])
}

describe('online bot identity and validation', () => {
  it('persists bots separately from guests, without adding users, memberships or claimable slots', async () => {
    const { owner, league, match } = await fixture()
    expect(match.players[1]).toEqual({ slot: 1, userId: null, guestId: null, botId: 'the-maximum', name: getBot('the-maximum')!.name, avatarUrl: null, guest: false })
    expect(match.players[0].botId).toBeNull()
    expect(ctx.db.get<{ count: number }>('SELECT COUNT(*) count FROM users')!.count).toBe(1)
    const detail = await owner.json('GET', `/api/leagues/${league.id}`, 200)
    expect(detail.league.members).toHaveLength(1)
    expect(detail.league.liveMatches[0].players[1].botId).toBe('the-maximum')
    expect((await owner.json('GET', `/api/invites/${league.inviteCode}`, 200)).guests).toEqual([])
    expect((await current(owner, match.id)).players).toEqual(match.players)
  })

  it('rejects unknown, duplicate, ambiguous, bot-only and oversized rosters and enforces membership', async () => {
    const { owner, league } = await fixture()
    const url = `/api/leagues/${league.id}/matches`
    const human = { userId: owner.userId }
    for (const players of [
      [human, { botId: 'not-a-bot' }], [human, { botId: 1 }],
      [human, { botId: 'the-maximum', guestName: 'Fake' }],
      [human, { botId: 'the-maximum' }, { botId: 'the-maximum' }],
      [{ botId: 'rookie-rue' }, { botId: 'the-maximum' }],
      [human, ...Array.from({ length: 8 }, () => ({ botId: 'the-maximum' }))],
      [{ guestName: 'Rollback' }, { botId: 'the-maximum' }, { botId: 'the-maximum' }],
    ]) await owner.json('POST', url, 400, { players, settings: DEFAULTS_101 })
    expect(ctx.db.get("SELECT 1 FROM users WHERE name = 'Rollback'")).toBeUndefined()
    const outsider = await devLogin(ctx.app, 'Outsider')
    await outsider.json('POST', url, 404, { players: [human, { botId: 'rookie-rue' }], settings: DEFAULTS_101 })
    const anonymous = new Client(ctx.app)
    await anonymous.json('POST', url, 401, { players: [human, { botId: 'rookie-rue' }], settings: DEFAULTS_101 })
  })

  it('allows league guests to invite and play bots with their existing identity', async () => {
    const owner = await devLogin(ctx.app, 'Owner')
    const league = await createLeague(owner)
    const guest = new Client(ctx.app)
    await guest.json('POST', `/api/invites/${league.inviteCode}/guest`, 200, { name: 'Guest' })
    const joined = await guest.json('GET', '/api/me', 200)
    const { match } = await guest.json<MatchResponse>('POST', `/api/leagues/${league.id}/matches`, 201, {
      players: [{ guestId: joined.user.id }, { botId: 'rookie-rue' }], settings: DEFAULTS_101,
    })
    expect(match.canScore).toBe(true)
    expect(match.players[0]).toMatchObject({ guest: true, botId: null, guestId: joined.user.id })
  })
})

describe('server-owned automatic turns', () => {
  it('throws one dart at a time once per match, broadcasting to two devices and the league', async () => {
    const { owner, league, match } = await fixture(true)
    const viewer = await devLogin(ctx.app, 'Viewer')
    await joinLeague(viewer, league.inviteCode)
    const a = (await owner.get(`/api/matches/${match.id}/events`)).body!.getReader()
    const b = (await viewer.get(`/api/matches/${match.id}/events`)).body!.getReader()
    const r = (await owner.get(`/api/leagues/${league.id}/events`)).body!.getReader()
    await event(a, 'match'); await event(b, 'match'); await event(r, 'league')
    await tick()
    const first = (await event(a, 'match')).match as MatchDetail
    const second = (await event(b, 'match')).match as MatchDetail
    expect(first.version).toBe(2)
    expect(first.state.currentVisit).toHaveLength(1)
    expect(first.state.players[0].score).toBe(441)
    expect(second.state).toEqual(first.state)
    expect(second.canScore).toBe(false)
    expect((await event(r, 'league')).match.players[0]).toMatchObject({ botId: 'the-maximum', score: 441 })
    await tick(2)
    const done = await current(owner, match.id)
    expect(done.version).toBe(4)
    expect(done.state.history).toHaveLength(1)
    expect(done.state.history[0].darts.map((dart) => dart.label)).toEqual(['T20', 'T20', 'T20'])
    expect(done.state.active).toBe(1)
    await tick(9)
    expect((await current(owner, match.id)).version).toBe(4)
    await Promise.all([a.cancel(), b.cancel(), r.cancel()])
  })

  it('blocks manual bot scoring and stale writes, including by the owner', async () => {
    const { owner, league, match } = await fixture(true)
    await owner.json('POST', `/api/matches/${match.id}/actions`, 400, { baseVersion: 1, action: { type: 'submit', entry: 'M' } })
    const spectator = await devLogin(ctx.app, 'Spectator')
    await joinLeague(spectator, league.inviteCode)
    await spectator.json('POST', `/api/matches/${match.id}/actions`, 403, { baseVersion: 1, action: { type: 'resetLeg' } })
    await tick()
    const conflict = await owner.json('POST', `/api/matches/${match.id}/actions`, 409, { baseVersion: 1, action: { type: 'resetLeg' } })
    expect(conflict.match.version).toBe(2)
    expect(conflict.match.state.currentVisit).toHaveLength(1)
  })

  it('cancels an in-flight turn on reset, deletion and shutdown without an extra dart', async () => {
    const { owner, match } = await fixture(true)
    await tick()
    const reset = await act(owner, await current(owner, match.id), { type: 'resetLeg' })
    expect(reset.state.currentVisit).toHaveLength(0)
    expect(reset.state.players[0].score).toBe(501)
    await vi.advanceTimersByTimeAsync(BOT_DART_DELAY_MS - 1)
    expect((await current(owner, match.id)).version).toBe(reset.version)
    await vi.advanceTimersByTimeAsync(1)
    expect((await current(owner, match.id)).version).toBe(reset.version + 1)
    ctx.app.services.bots.stop()
    await tick(6)
    expect((await current(owner, match.id)).version).toBe(reset.version + 1)
    await owner.json('DELETE', `/api/matches/${match.id}`, 204)
    await tick(6)
    expect(ctx.db.get('SELECT id FROM matches WHERE id = ?', match.id)).toBeUndefined()
  })

  it('handles consecutive bots, pausing at human turns', async () => {
    const { owner, match } = await fixture(true, { ...DEFAULTS_101, game: 501 }, [{ botId: 'rookie-rue' }])
    await tick(6)
    const next = await current(owner, match.id)
    expect(next.version).toBe(7)
    expect(next.state.active).toBe(2)
    expect(next.state.history.map((visit) => visit.player)).toEqual([0, 1])
    await tick(4)
    expect((await current(owner, match.id)).version).toBe(7)
  })

  it('resumes partial visits after app restart without clients and cancels on match or league deletion', async () => {
    const { owner, league, match } = await fixture(true)
    await tick()
    ctx.app.services.bots.stop()
    const restarted = createApp({ db: ctx.db, config: ctx.config, now: ctx.clock.now, google: null, botRandom: () => 0 })
    ctx.app = restarted
    const reconnected = new Client(restarted)
    reconnected.cookies = new Map(owner.cookies)
    await tick(2)
    expect((await current(reconnected, match.id)).state.history).toHaveLength(1)
    await reconnected.json('DELETE', `/api/matches/${match.id}`, 204)
    const { match: second } = await reconnected.json<MatchResponse>('POST', `/api/leagues/${league.id}/matches`, 201, {
      players: [{ botId: 'the-maximum' }, { userId: owner.userId }], settings: DEFAULTS_101,
    })
    await reconnected.json('DELETE', `/api/leagues/${league.id}`, 204)
    await tick(10)
    expect(ctx.db.get('SELECT id FROM matches WHERE id = ?', second.id)).toBeUndefined()
  })

  it('resets pending throws, safely undoes bot replies, and pauses for next-leg/result confirmation', async () => {
    const { owner, match: initial } = await fixture(false, { ...DEFAULTS_101, legsToWin: 2 })
    let match = await play(owner, initial, 'M M M')
    await tick(2)
    match = await current(owner, match.id)
    expect(match.state.active).toBe(1)
    match = await act(owner, match, { type: 'undo' })
    expect(match.state.active).toBe(0)
    expect(match.state.currentVisit).toHaveLength(2)
    expect(match.state.players[1].score).toBe(101)
    await tick(4)
    expect((await current(owner, match.id)).version).toBe(match.version)
    match = await act(owner, match, { type: 'resetLeg' })
    match = await play(owner, match, CHECKOUT_101)
    await tick(4)
    expect((await current(owner, match.id)).version).toBe(match.version)
    const legId = match.state.legHistory[0].id
    match = await act(owner, match, { type: 'nextLeg' })
    await tick(3)
    match = await current(owner, match.id)
    expect(match.state.winner).toBe(1)
    await tick(4)
    expect((await current(owner, match.id)).version).toBe(match.version)
    match = await act(owner, match, { type: 'rewind', legId, visitIndex: 0 })
    expect(match.state.winner).toBeNull()
    expect(match.state.active).toBe(0)
    expect(match.state.players.map((p) => p.legs)).toEqual([0, 0])
    match = await play(owner, match, 'M M M')
    await tick(3)
    match = await current(owner, match.id)
    const botLeg = match.state.legHistory[0].id
    match = await act(owner, match, { type: 'rewind', legId: botLeg, visitIndex: 1 })
    expect(match.state.active).toBe(1)
    await tick(3)
    match = await current(owner, match.id)
    match = await act(owner, match, { type: 'nextLeg' })
    await tick(3)
    match = await current(owner, match.id)
    expect(match.state.matchWinner).toBe(1)
    expect(match.status).toBe('live')
    match = await finish(owner, match)
    expect(match.status).toBe('completed')
    expect(match.results![1].stats.checkouts).toBe(2)
    await tick(6)
    expect((await current(owner, match.id)).version).toBe(match.version)
  })

  it('does not undo bot-only opening visits without a human entry to correct', async () => {
    const { owner, match } = await fixture(true)
    await tick()
    let latest = await current(owner, match.id)
    expect((await act(owner, latest, { type: 'undo' })).version).toBe(latest.version)
    await tick(2)
    latest = await current(owner, match.id)
    expect((await act(owner, latest, { type: 'undo' })).version).toBe(latest.version)
  })
})

it('keeps even mixed human/bot matches out of Elo and rating history while retaining statistics', async () => {
  const { owner, league, match: unused } = await fixture()
  await owner.json('DELETE', `/api/matches/${unused.id}`, 204)
  const second = await devLogin(ctx.app, 'Second')
  await joinLeague(second, league.inviteCode)
  const humans = [{ userId: owner.userId! }, { userId: second.userId! }]
  const ranked = await finish(owner, await play(owner, await createMatch(owner, league.id, humans), CHECKOUT_101))
  ctx.clock.advance(1000)
  const { match: practice } = await owner.json<MatchResponse>('POST', `/api/leagues/${league.id}/matches`, 201, {
    players: [...humans, { botId: 'the-maximum' }], settings: DEFAULTS_101,
  })
  const done = await finish(owner, await play(owner, practice, CHECKOUT_101))
  expect(done.results!.map((result) => [result.ratingBefore, result.ratingAfter])).toEqual([[null, null], [null, null], [null, null]])
  expect(done.results![0].stats.points).toBe(101)
  const leagueDetail = await owner.json('GET', `/api/leagues/${league.id}`, 200)
  expect(leagueDetail.league.members.map((member: { rating: number }) => member.rating)).toEqual([1016, 984])
  const stats = await owner.json('GET', `/api/leagues/${league.id}/players/${owner.userId}`, 200)
  expect(stats.ratingHistory).toHaveLength(1)
  expect(stats.entry).toMatchObject({ matches: 1, wins: 1, losses: 0, form: ['W'] })
  expect(stats.headToHead).toEqual([{ opponent: { id: second.userId, name: 'Second', avatarUrl: null }, wins: 1, losses: 0 }])
  expect(stats.recentMatches.map((m: MatchDetail) => m.id)).toEqual([ranked.id])
  expect(stats.training.totals.matches).toBe(1)
  expect(stats.training.recentMatches.map((m: MatchDetail) => m.id)).toEqual([done.id])
  for (const key of ['wins', 'losses', 'winRate']) expect(stats.training.totals).not.toHaveProperty(key)

  // A bot win is still training, including human-v-human pairs in the same game.
  const { match: loss } = await owner.json<MatchResponse>('POST', `/api/leagues/${league.id}/matches`, 201, {
    players: [{ botId: 'the-maximum' }, ...humans], settings: DEFAULTS_101,
  })
  await tick(3)
  const lost = await finish(owner, await current(owner, loss.id))
  expect(lost.results![0].won).toBe(true)
  const career = await owner.json('GET', '/api/me/stats', 200)
  expect(career.totals).toMatchObject({ matches: 1, wins: 1, losses: 0 })
  expect(career.training.totals).toMatchObject({ matches: 2, average: 101 })
  for (const key of ['wins', 'losses', 'winRate']) expect(career.training.totals).not.toHaveProperty(key)
  const board = await owner.json('GET', `/api/leagues/${league.id}/leaderboard`, 200)
  expect(board.entries.find((e: { id: string }) => e.id === second.userId)).toMatchObject({ matches: 1, losses: 1, form: ['L'] })
  await owner.json('DELETE', `/api/matches/${ranked.id}`, 204)
  expect((await current(owner, done.id)).results!.every((result) => result.ratingAfter === null)).toBe(true)
  const leagueAfter = await owner.json('GET', `/api/leagues/${league.id}`, 200)
  expect(leagueAfter.league.members.map((member: { rating: number }) => member.rating)).toEqual([1000, 1000])
})

it('adds bot identity to a v2 database without altering existing participants or match state', () => {
  const db = new Db(new DatabaseSync(':memory:'))
  migrate(db, 2)
  db.raw.exec(`INSERT INTO users (id, google_sub, email, name, created_at, last_login_at) VALUES ('human', 'g', 'e', 'Human', 'now', 'now');
    INSERT INTO users (id, google_sub, email, name, created_at, last_login_at, is_guest, guest_room_id, guest_name_key, claimed)
      VALUES ('guest', 'guest:guest', '', 'Guest', 'now', 'now', 1, 'league', 'guest', 0);
    INSERT INTO rooms VALUES ('league', 'League', 'human', 'CODE', 'now', 'now');
    INSERT INTO matches VALUES ('old', 'league', 'human', 'live', '{}', '{"untouched":true}', 1, 'now', 'now', NULL);
    INSERT INTO match_players (match_id, slot, user_id, guest_id, name) VALUES ('old', 0, 'human', NULL, 'Human'), ('old', 1, NULL, 'guest', 'Guest');`)
  migrate(db)
  expect(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version).toBe(SCHEMA_VERSION)
  expect(db.all('SELECT name, bot_id FROM match_players')).toEqual([{ name: 'Human', bot_id: null }, { name: 'Guest', bot_id: null }])
  expect(db.get('SELECT state, practice FROM matches')).toEqual({ state: '{"untouched":true}', practice: 0 })
  expect(() => db.run("UPDATE match_players SET bot_id = 'the-maximum' WHERE user_id IS NOT NULL")).toThrow()
  migrate(db)
  db.close()
})

it('classifies historical bot matches as practice when upgrading to v5', () => {
  const db = new Db(new DatabaseSync(':memory:'))
  migrate(db, 4)
  db.raw.exec(`INSERT INTO users (id, google_sub, email, name, created_at, last_login_at) VALUES ('human', 'g', 'e', 'Human', 'now', 'now');
    INSERT INTO rooms VALUES ('league', 'League', 'human', 'CODE', 'now', 'now');
    INSERT INTO room_members VALUES ('league', 'human', 'owner', 'now');
    INSERT INTO matches VALUES ('bot', 'league', 'human', 'completed', '{}', '{}', 3, 'now', 'now', 'now'), ('people', 'league', 'human', 'live', '{}', '{}', 1, 'now', 'now', NULL);
    INSERT INTO match_players (match_id, slot, user_id, guest_id, bot_id, name) VALUES ('bot', 0, 'human', NULL, NULL, 'Human'), ('bot', 1, NULL, NULL, 'pub-pete', 'Pub Pete'),
      ('people', 0, 'human', NULL, NULL, 'Human'), ('people', 1, NULL, NULL, NULL, 'Friend');
    INSERT INTO training_sessions VALUES ('t', 'league', 'human', 'nine-dart', 'live', '[]', '{}', 0, 'now', NULL);`)
  migrate(db)
  expect(db.all('SELECT id, league_id, practice, ranked FROM matches ORDER BY id')).toEqual([
    { id: 'bot', league_id: 'league', practice: 1, ranked: 0 },
    { id: 'people', league_id: 'league', practice: 0, ranked: 0 },
  ])
  expect(db.all('SELECT league_id, user_id, role FROM league_members')).toEqual([{ league_id: 'league', user_id: 'human', role: 'owner' }])
  expect(db.get('SELECT league_id FROM training_sessions')).toEqual({ league_id: 'league' })
  expect(db.all('SELECT match_id, slot FROM match_players ORDER BY match_id, slot')).toHaveLength(4)
  expect(db.all('PRAGMA foreign_key_check')).toEqual([])
  // Deleting a league still cascades through the rebuilt tables.
  db.run('DELETE FROM leagues WHERE id = ?', 'league')
  expect(db.all('SELECT id FROM matches')).toEqual([])
  expect(db.all('SELECT match_id FROM match_players')).toEqual([])
  db.close()
})
