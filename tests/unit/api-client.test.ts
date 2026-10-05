import { afterEach, expect, it, vi } from 'vitest'
import { api, ApiRequestError } from '../../src/online/api'

afterEach(() => vi.unstubAllGlobals())
it('sends explicit same-origin JSON on bodyless mutations, including DELETE and logout', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  await api.deleteLeague('league')
  await api.logout()
  await api.regenerateInvite('league')
  for (const [, options] of fetch.mock.calls as unknown as [string, RequestInit][]) {
    expect(options.body).toBe('{}')
    expect(options.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(options.credentials).toBe('same-origin')
  }
})
it('propagates failures instead of reporting a successful sign out', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'forbidden', message: 'Rejected' }), { status: 403 })))
  await expect(api.logout()).rejects.toBeInstanceOf(ApiRequestError)
})
