import { describe, expect, it } from 'vitest'
import type { LeaderboardResponse, MeResponse, LeagueResponse, UpdateMeResponse } from '../../src/shared/api'
import { CHECKOUT_101, Client, createMatch, createLeague, devLogin, finish, joinLeague, play, setup } from './helpers'

describe('dart nicknames', () => {
  it('updates only the signed-in profile and persists across sessions', async () => {
    const ctx = setup()
    try {
      const alice = await devLogin(ctx.app, 'Alice')
      const bob = await devLogin(ctx.app, 'Bob')
      const original = (await alice.json<MeResponse>('GET', '/api/me', 200)).user!
      const otherDevice = await devLogin(ctx.app, 'Alice')
      const { user } = await alice.json<UpdateMeResponse>('PATCH', '/api/me', 200, {
        name: '  The Power 🎯  ',
        id: bob.userId,
        email: 'changed@example.com',
      })
      expect(user).toEqual({ ...original, name: 'The Power 🎯' })
      expect((await bob.json<MeResponse>('GET', '/api/me', 200)).user?.name).toBe('Bob')
      expect((await otherDevice.json<MeResponse>('GET', '/api/me', 200)).user).toEqual(user)

      const crossOrigin = await alice.patch('/api/me', { name: 'Unwanted' }, { headers: { origin: 'https://evil.example' } })
      expect(crossOrigin.status).toBe(403)
      await new Client(ctx.app).json('PATCH', '/api/me', 401, { name: 'Unwanted' })
      await alice.json('POST', '/auth/logout', 204)
      await alice.json('PATCH', '/api/me', 401, { name: 'Unwanted' })
      const returning = await devLogin(ctx.app, 'Alice')
      expect((await returning.json<MeResponse>('GET', '/api/me', 200)).user).toEqual(user)
    } finally {
      ctx.db.close()
    }
  })

  it('uses the nickname for leagues, leaderboards and new matches without rewriting results', async () => {
    const ctx = setup()
    try {
      const alice = await devLogin(ctx.app, 'Alice')
      const bob = await devLogin(ctx.app, 'Bob')
      const league = await createLeague(alice)
      await joinLeague(bob, league.inviteCode)
      const players = [{ userId: alice.userId! }, { userId: bob.userId! }]
      const recorded = await finish(alice, await play(alice, await createMatch(alice, league.id, players), CHECKOUT_101))
      const before = await bob.json<LeaderboardResponse>('GET', `/api/leagues/${league.id}/leaderboard`, 200)
      await alice.json('PATCH', '/api/me', 200, { name: 'The Power' })

      const { league: updatedLeague } = await bob.json<LeagueResponse>('GET', `/api/leagues/${league.id}`, 200)
      expect(updatedLeague.owner.name).toBe('The Power')
      expect(updatedLeague.members.find((member) => member.id === alice.userId)?.name).toBe('The Power')
      const after = await bob.json<LeaderboardResponse>('GET', `/api/leagues/${league.id}/leaderboard`, 200)
      expect(after.entries).toEqual(before.entries.map((entry) => entry.id === alice.userId ? { ...entry, name: 'The Power' } : entry))

      const next = await createMatch(bob, league.id, players)
      expect(next.players[0].name).toBe('The Power')
      expect(next.state.players[0].name).toBe('The Power')
      const { match } = await bob.json('GET', `/api/matches/${recorded.id}`, 200)
      expect(match.players).toEqual(recorded.players)
      expect(match.state).toEqual(recorded.state)
      expect(match.results).toEqual(recorded.results)
    } finally {
      ctx.db.close()
    }
  })
})
