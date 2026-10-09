import sharp from 'sharp'
import type { UpdateMeResponse } from '../../src/shared/api'
import { afterEach, describe, expect, it } from 'vitest'
import { AVATAR_MAX_BYTES } from '../../server/avatar'
import { upsertIdentity } from '../../server/users'
import { Client, devLogin, ORIGIN, setup, type TestContext } from './helpers'

let context: TestContext
function start() { context = setup(); return context }
afterEach(() => { context?.app.services.bots.stop(); context?.db.close() })
const picture = () => sharp({ create: { width: 320, height: 160, channels: 3, background: '#8040ff' } }).png().toBuffer()
async function upload(client: Client, body: Uint8Array, headers: Record<string, string> = {}) {
  return client.app.request('/api/me/avatar', { method: 'PUT', body: new Uint8Array(body), headers: { cookie: client.cookieHeader(), origin: ORIGIN, 'content-type': 'image/png', ...headers } })
}

describe('profile pictures', () => {
  it('normalizes, persists, versions and removes only the authenticated user picture', async () => {
    const { app, db } = start()
    const alice = await devLogin(app, 'Alice')
    const bob = await devLogin(app, 'Bob')
    const response = await upload(alice, await picture())
    expect(response.status).toBe(200)
    const { user } = await response.json() as UpdateMeResponse
    expect(user.avatarUrl).toMatch(/^\/api\/avatars\/.+\/.+\.webp$/)
    expect((await alice.json('GET', '/api/me', 200)).user.avatarUrl).toBe(user.avatarUrl)
    expect((await bob.json('GET', '/api/me', 200)).user.avatarUrl).toBeNull()
    const image = await app.request(user.avatarUrl!)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/webp')
    expect(image.headers.get('x-content-type-options')).toBe('nosniff')
    expect(image.headers.get('cache-control')).toContain('immutable')
    const metadata = await sharp(Buffer.from(await image.arrayBuffer())).metadata()
    expect(metadata).toMatchObject({ width: 256, height: 256, format: 'webp' })
    expect(metadata.exif).toBeUndefined()
    const replacement = await (await upload(alice, await picture())).json() as UpdateMeResponse
    expect(replacement.user.avatarUrl).not.toBe(user.avatarUrl)
    expect((await app.request(user.avatarUrl!)).status).toBe(404)
    expect((await alice.json('DELETE', '/api/me/avatar', 200)).user.avatarUrl).toBeNull()
    expect(db.get('SELECT image FROM user_avatars WHERE user_id = ?', alice.userId!)).toEqual({ image: null })
    expect((await app.request(replacement.user.avatarUrl!)).status).toBe(404)
  })

  it('retains custom and removed pictures across provider sign-ins, but refreshes untouched defaults', async () => {
    const { app, db, clock } = start()
    const alice = await devLogin(app, 'Alice')
    const stored = db.get<{ google_sub: string }>('SELECT google_sub FROM users WHERE id = ?', alice.userId!)!
    const input = { subject: stored.google_sub, email: 'alice@example.com', name: 'Alice', avatarUrl: 'https://lh3.googleusercontent.com/first', now: clock.now().toISOString() }
    expect(upsertIdentity(db, input).avatar_url).toBe(input.avatarUrl)
    input.avatarUrl += '-new'
    expect(upsertIdentity(db, input).avatar_url).toBe(input.avatarUrl)
    const { user } = await (await upload(alice, await picture())).json() as UpdateMeResponse
    expect(upsertIdentity(db, input).avatar_url).toBe(user.avatarUrl)
    await alice.json('DELETE', '/api/me/avatar', 200)
    expect(upsertIdentity(db, input).avatar_url).toBeNull()
  })

  it('rejects unauthenticated, guest and cross-origin mutations', async () => {
    const { app, db } = start()
    const png = await picture()
    const anon = new Client(app)
    expect((await upload(anon, png)).status).toBe(401)
    expect((await anon.delete('/api/me/avatar')).status).toBe(401)
    const alice = await devLogin(app, 'Alice')
    expect((await upload(alice, png, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await upload(alice, png, { origin: '' })).status).toBe(403)
    expect((await upload(alice, png, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await alice.delete('/api/me/avatar', { headers: { origin: 'https://evil.example' } })).status).toBe(403)
    db.run('UPDATE users SET is_guest = 1 WHERE id = ?', alice.userId!)
    expect((await upload(alice, png)).status).toBe(403)
    expect((await alice.delete('/api/me/avatar')).status).toBe(403)
    expect(db.all('SELECT * FROM user_avatars')).toEqual([])
  })

  it('rejects oversized, empty, spoofed and malformed images without changing the profile', async () => {
    const { app, db } = start()
    const alice = await devLogin(app, 'Alice')
    const png = await picture()
    expect((await upload(alice, png, { 'content-length': String(AVATAR_MAX_BYTES + 1) })).status).toBe(413)
    expect((await upload(alice, new Uint8Array(AVATAR_MAX_BYTES + 1))).status).toBe(413)
    expect((await upload(alice, new Uint8Array())).status).toBe(400)
    expect((await upload(alice, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).status).toBe(400)
    expect((await upload(alice, png, { 'content-type': 'image/jpeg' })).status).toBe(400)
    expect((await upload(alice, png, { 'content-type': 'image/svg+xml' })).status).toBe(415)
    expect((await upload(alice, png.subarray(0, 40))).status).toBe(400)
    expect(db.all('SELECT * FROM user_avatars')).toEqual([])
  })

  it('accepts JPEG and WebP and rejects decoded pixel bombs', async () => {
    const { app } = start()
    const alice = await devLogin(app, 'Alice')
    for (const format of ['jpeg', 'webp'] as const) {
      const buffer = await sharp(await picture())[format]().toBuffer()
      expect((await upload(alice, buffer, { 'content-type': `image/${format}` })).status).toBe(200)
    }
    const huge = await sharp({ create: { width: 7000, height: 6000, channels: 3, background: '#fff' } }).png().toBuffer()
    expect((await upload(alice, huge)).status).toBe(400)
  })
})
