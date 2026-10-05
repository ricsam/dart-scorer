import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sanitizeReturnTo } from '../../server/auth'
import { loadConfig } from '../../server/config'
import { CONTENT_SECURITY_POLICY } from '../../server/security'
import { Client, DAY, devLogin, ORIGIN, setup, type TestContext } from './helpers'

async function startGoogle(ctx: TestContext, client: Client, returnTo?: string) {
  const response = await client.get(`/auth/google${returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`}`)
  expect(response.status).toBe(302)
  const location = new URL(response.headers.get('location')!)
  const nonce = location.searchParams.get('nonce')!
  ctx.google.lastNonce = nonce
  return { location, state: location.searchParams.get('state')!, nonce, response }
}

describe('Google sign-in', () => {
  it('redirects to Google with PKCE, state and nonce', async () => {
    const ctx = setup()
    const client = new Client(ctx.app)
    const { location, response } = await startGoogle(ctx, client, '/leagues/abc')
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(location.searchParams.get('client_id')).toBe('test-client-id')
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/google/callback`)
    expect(location.searchParams.get('response_type')).toBe('code')
    expect(location.searchParams.get('scope')).toBe('openid email profile')
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location.searchParams.get('prompt')).toBe('select_account')
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith('oche_oauth_state='))!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/Path=\/auth/)
    expect(cookie).toMatch(/Max-Age=600/)
    expect(cookie).not.toMatch(/Secure/)

    // The verifier sent to the token endpoint must hash to the advertised challenge.
    const callback = await client.get(`/auth/google/callback?code=abc&state=${location.searchParams.get('state')}`)
    expect(callback.status).toBe(302)
    const verifier = ctx.google.calls[0].codeVerifier
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(location.searchParams.get('code_challenge'))
    expect(ctx.google.calls[0].redirectUri).toBe(`${ORIGIN}/auth/google/callback`)
  })

  it('creates a user and session, then redirects to returnTo', async () => {
    const ctx = setup()
    const client = new Client(ctx.app)
    const { state } = await startGoogle(ctx, client, '/leagues/abc?tab=live')
    const response = await client.get(`/auth/google/callback?code=good&state=${state}`)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/leagues/abc?tab=live')
    const session = response.headers.getSetCookie().find((value) => value.startsWith('oche_session='))!
    expect(session).toMatch(/HttpOnly/i)
    expect(session).toMatch(/SameSite=Lax/i)
    expect(session).toMatch(/Path=\//)
    expect(client.cookies.has('oche_oauth_state')).toBe(false)

    const me = await client.json('GET', '/api/me', 200)
    expect(me.user).toMatchObject({ name: 'Alex', email: 'alex@example.com', avatarUrl: 'https://lh3.googleusercontent.com/a/alex' })
    expect(me.auth).toEqual({ google: true, dev: true })

    // Returning users keep their chosen name but get a fresh email/avatar.
    await client.json('PATCH', '/api/me', 200, { name: '  The Power ' })
    const second = new Client(ctx.app)
    ctx.google.identity = { email: 'alex@new.example', picture: 'https://lh3.googleusercontent.com/a/new' }
    const again = await startGoogle(ctx, second)
    const redirect = await second.get(`/auth/google/callback?code=good&state=${again.state}`)
    expect(redirect.headers.get('location')).toBe('/')
    const me2 = await second.json('GET', '/api/me', 200)
    expect(me2.user).toMatchObject({ id: me.user.id, name: 'The Power', email: 'alex@new.example', avatarUrl: 'https://lh3.googleusercontent.com/a/new' })
  })

  it('names new users from given_name, name or the email local part (max 24 chars)', async () => {
    const ctx = setup()
    ctx.google.identity = { sub: 'sub-2', givenName: null, name: null, email: 'averyveryverylongemailaddress.name@example.com' }
    const client = new Client(ctx.app)
    const { state } = await startGoogle(ctx, client)
    await client.get(`/auth/google/callback?code=x&state=${state}`)
    const me = await client.json('GET', '/api/me', 200)
    expect(me.user.name).toBe('averyveryverylongemailad')
  })

  it('rejects a callback whose state does not match the cookie', async () => {
    const ctx = setup()
    const client = new Client(ctx.app)
    const { state } = await startGoogle(ctx, client)
    client.cookies.set('oche_oauth_state', 'something-else-entirely')
    const response = await client.get(`/auth/google/callback?code=x&state=${state}`)
    expect(response.headers.get('location')).toBe('/login?error=state_mismatch')
    expect(client.cookies.has('oche_session')).toBe(false)
    expect(ctx.google.calls).toHaveLength(0)

    const noCookie = new Client(ctx.app)
    const response2 = await noCookie.get(`/auth/google/callback?code=x&state=${state}`)
    expect(response2.headers.get('location')).toBe('/login?error=state_mismatch')
  })

  it('uses each state once and expires it after 10 minutes', async () => {
    const ctx = setup()
    const client = new Client(ctx.app)
    const { state } = await startGoogle(ctx, client)
    const cookie = client.cookies.get('oche_oauth_state')!
    expect((await client.get(`/auth/google/callback?code=x&state=${state}`)).headers.get('location')).toBe('/')

    const replay = new Client(ctx.app)
    replay.cookies.set('oche_oauth_state', cookie)
    expect((await replay.get(`/auth/google/callback?code=x&state=${state}`)).headers.get('location')).toBe('/login?error=state_expired')

    const late = new Client(ctx.app)
    const second = await startGoogle(ctx, late)
    ctx.clock.advance(11 * 60 * 1000)
    expect((await late.get(`/auth/google/callback?code=x&state=${second.state}`)).headers.get('location')).toBe('/login?error=state_expired')
  })

  it('maps Google errors, nonce mismatches and unverified emails to login errors', async () => {
    const ctx = setup()
    const denied = new Client(ctx.app)
    const first = await startGoogle(ctx, denied)
    expect((await denied.get(`/auth/google/callback?error=access_denied&state=${first.state}`)).headers.get('location')).toBe('/login?error=access_denied')

    const badNonce = new Client(ctx.app)
    const second = await startGoogle(ctx, badNonce)
    ctx.google.nonceOverride = 'not-the-nonce'
    expect((await badNonce.get(`/auth/google/callback?code=x&state=${second.state}`)).headers.get('location')).toBe('/login?error=google_failed')
    ctx.google.nonceOverride = undefined

    const unverified = new Client(ctx.app)
    const third = await startGoogle(ctx, unverified)
    ctx.google.identity = { emailVerified: false }
    expect((await unverified.get(`/auth/google/callback?code=x&state=${third.state}`)).headers.get('location')).toBe('/login?error=email_unverified')
    ctx.google.identity = {}

    const failing = new Client(ctx.app)
    const fourth = await startGoogle(ctx, failing)
    ctx.google.fail = true
    expect((await failing.get(`/auth/google/callback?code=x&state=${fourth.state}`)).headers.get('location')).toBe('/login?error=google_failed')
    expect(failing.cookies.has('oche_session')).toBe(false)
  })

  it('sanitizes returnTo to same-origin relative paths', async () => {
    expect(sanitizeReturnTo('/leagues/1?x=2#y')).toBe('/leagues/1?x=2#y')
    expect(sanitizeReturnTo(undefined)).toBe('/')
    expect(sanitizeReturnTo('')).toBe('/')
    expect(sanitizeReturnTo('https://evil.example/')).toBe('/')
    expect(sanitizeReturnTo('//evil.example/')).toBe('/')
    expect(sanitizeReturnTo('/\\evil.example')).toBe('/')
    expect(sanitizeReturnTo('\\\\evil.example')).toBe('/')
    expect(sanitizeReturnTo('/%0d%0aSet-Cookie:x')).toBe('/%0d%0aSet-Cookie:x')
    expect(sanitizeReturnTo('/\tfoo')).toBe('/')
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/')
    expect(sanitizeReturnTo('leagues')).toBe('/')

    const ctx = setup()
    const client = new Client(ctx.app)
    const { state } = await startGoogle(ctx, client, '//evil.example/steal')
    expect((await client.get(`/auth/google/callback?code=x&state=${state}`)).headers.get('location')).toBe('/')
  })

  it('reports Google as unavailable when it is not configured', async () => {
    const ctx = setup({ config: { google: null }, deps: { google: null } })
    const client = new Client(ctx.app)
    const response = await client.get('/auth/google')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/login?error=google_unavailable')
    expect((await client.json('GET', '/api/me', 200)).auth.google).toBe(false)
  })
})

describe('dev login', () => {
  it('is ignored in production even when DEV_LOGIN=true', () => {
    const { config, warnings } = loadConfig({ NODE_ENV: 'production', DEV_LOGIN: 'true', PUBLIC_URL: 'https://oche.example' })
    expect(config.devLogin).toBe(false)
    expect(warnings.some((warning) => warning.includes('DEV_LOGIN'))).toBe(true)
    expect(loadConfig({ DEV_LOGIN: 'true' }).config.devLogin).toBe(true)
    expect(loadConfig({}).config.devLogin).toBe(false)
  })

  it('returns 404 when disabled', async () => {
    const ctx = setup({ config: { devLogin: false } })
    const client = new Client(ctx.app)
    const response = await client.post('/auth/dev-login', { name: 'Sam', email: 'sam@example.com' })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'not_found' })
    expect((await client.json('GET', '/api/me', 200)).auth.dev).toBe(false)
  })

  it('upserts by email and validates input', async () => {
    const ctx = setup()
    const client = new Client(ctx.app)
    const first = await client.json('POST', '/auth/dev-login', 200, { name: 'Sam', email: 'Sam@Example.com' })
    expect(first.user).toMatchObject({ name: 'Sam', email: 'sam@example.com', avatarUrl: null })
    const again = await new Client(ctx.app).json('POST', '/auth/dev-login', 200, { name: 'Other', email: 'sam@example.com' })
    expect(again.user.id).toBe(first.user.id)
    await client.json('POST', '/auth/dev-login', 400, { name: '', email: 'x@example.com' })
    await client.json('POST', '/auth/dev-login', 400, { name: 'Sam', email: 'not-an-email' })
    await client.json('POST', '/auth/dev-login', 400, { name: 'x'.repeat(25), email: 'x@example.com' })
  })
})

describe('sessions', () => {
  it('authenticates API calls and logs out', async () => {
    const ctx = setup()
    const anonymous = new Client(ctx.app)
    expect(await anonymous.json('GET', '/api/me', 200)).toEqual({ user: null, auth: { google: true, dev: true } })
    expect(await anonymous.json('GET', '/api/leagues', 401)).toMatchObject({ error: 'unauthorized' })

    const client = await devLogin(ctx.app, 'Sam')
    const token = client.cookies.get('oche_session')!
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // Only a hash of the token is stored.
    const stored = ctx.db.all<{ token_hash: string }>('SELECT token_hash FROM sessions')
    expect(stored.map((row) => row.token_hash)).toEqual([createHash('sha256').update(token).digest('hex')])
    await client.json('GET', '/api/leagues', 200)

    const logout = await client.post('/auth/logout')
    expect(logout.status).toBe(204)
    expect(client.cookies.has('oche_session')).toBe(false)
    const stale = new Client(ctx.app)
    stale.cookies.set('oche_session', token)
    await stale.json('GET', '/api/leagues', 401)
    expect(ctx.db.all('SELECT * FROM sessions')).toHaveLength(0)
  })

  it('renews sessions with under 30 days left and rejects expired ones', async () => {
    const ctx = setup()
    const client = await devLogin(ctx.app, 'Sam')
    ctx.clock.advanceDays(20)
    const early = await client.get('/api/me')
    expect(early.headers.getSetCookie()).toHaveLength(0)

    ctx.clock.advanceDays(15) // 35 days in: 25 left → renewed to 60
    const renewed = await client.get('/api/me')
    expect(renewed.headers.getSetCookie().some((cookie) => cookie.startsWith('oche_session=') && /Max-Age=5184000/.test(cookie))).toBe(true)

    // Unused for 60 days after the renewal: expired.
    ctx.clock.advance(60 * DAY + 1000)
    expect((await client.json('GET', '/api/me', 200)).user).toBeNull()
    expect(client.cookies.has('oche_session')).toBe(false)
    expect(ctx.db.all('SELECT * FROM sessions')).toHaveLength(0)
  })

  it('uses __Host- cookies, Secure and HSTS for https deployments', async () => {
    const ctx = setup({ config: { publicUrl: 'https://oche.example', publicOrigin: 'https://oche.example', secure: true } })
    const client = new Client(ctx.app)
    client.origin = 'https://oche.example'
    const response = await client.post('/auth/dev-login', { name: 'Sam', email: 'sam@example.com' })
    expect(response.status).toBe(200)
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith('__Host-oche_session='))!
    expect(cookie).toMatch(/Secure/)
    expect(cookie).toMatch(/Path=\//)
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000')
    expect((await client.json('GET', '/api/me', 200)).user.name).toBe('Sam')

    const start = await client.get('/auth/google')
    expect(start.headers.getSetCookie().some((value) => value.startsWith('__Secure-oche_oauth_state=') && /Secure/.test(value))).toBe(true)
    expect(new URL(start.headers.get('location')!).searchParams.get('redirect_uri')).toBe('https://oche.example/auth/google/callback')
  })
})

describe('request hardening', () => {
  it('rejects cross-origin mutations and non-JSON bodies', async () => {
    const ctx = setup()
    const client = await devLogin(ctx.app, 'Sam')
    const crossOrigin = await client.post('/api/leagues', { name: 'League' }, { headers: { origin: 'https://evil.example' } })
    expect(crossOrigin.status).toBe(403)
    expect(await crossOrigin.json()).toMatchObject({ error: 'forbidden' })

    const crossLogout = await client.post('/auth/logout', undefined, { headers: { origin: 'https://evil.example' } })
    expect(crossLogout.status).toBe(403)
    expect((await client.json('GET', '/api/me', 200)).user).not.toBeNull()

    const form = await client.request('POST', '/api/leagues', { rawBody: 'name=League', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(form.status).toBe(415)
    expect(await form.json()).toMatchObject({ error: 'bad_request' })

    const textPlain = await client.request('POST', '/api/leagues', { rawBody: '{"name":"League"}', headers: { 'content-type': 'text/plain' } })
    expect(textPlain.status).toBe(415)

    const invalid = await client.request('POST', '/api/leagues', { rawBody: '{nope', headers: { 'content-type': 'application/json' } })
    expect(invalid.status).toBe(400)

    const huge = await client.post('/api/leagues', { name: 'x'.repeat(70 * 1024) })
    expect(huge.status).toBe(413)

    const withCharset = await client.request('POST', '/api/leagues', { rawBody: '{"name":"League"}', headers: { 'content-type': 'application/json; charset=utf-8' } })
    expect(withCharset.status).toBe(201)

    // Requests without an Origin header (e.g. same-origin tooling) are still allowed.
    client.origin = null
    expect((await client.post('/api/leagues', { name: 'League 2' })).status).toBe(201)
  })

  it('sets security headers and returns JSON errors', async () => {
    const ctx = setup()
    const client = new Client(ctx.app)
    const response = await client.get('/api/nope')
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'not_found' })
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('strict-transport-security')).toBeNull()
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'")

    const health = await client.get('/healthz')
    expect(health.status).toBe(200)
    expect(await health.text()).toBe('ok')
    const ready = await client.get('/readyz')
    expect(await ready.text()).toBe('ok')
  })

  it('rate limits auth routes per client IP', async () => {
    const ctx = setup({ limits: { authPerMinute: 3 }, config: { trustProxy: true } })
    const hit = (ip: string) => new Client(ctx.app).request('POST', '/auth/logout', { headers: { 'cf-connecting-ip': ip } })
    expect((await hit('1.1.1.1')).status).toBe(204)
    expect((await hit('1.1.1.1')).status).toBe(204)
    expect((await hit('1.1.1.1')).status).toBe(204)
    const limited = await hit('1.1.1.1')
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ error: 'rate_limited' })
    expect((await hit('2.2.2.2')).status).toBe(204)
    ctx.clock.advance(61_000)
    expect((await hit('1.1.1.1')).status).toBe(204)
  })

  it('rate limits mutations per user', async () => {
    const ctx = setup({ limits: { mutationsPerMinute: 2 } })
    const client = await devLogin(ctx.app, 'Sam')
    await client.json('PATCH', '/api/me', 200, { name: 'A' })
    await client.json('PATCH', '/api/me', 200, { name: 'B' })
    await client.json('PATCH', '/api/me', 429, { name: 'C' })
    await client.json('GET', '/api/me', 200)
  })

  it('validates profile names', async () => {
    const ctx = setup()
    const client = await devLogin(ctx.app, 'Sam')
    await client.json('PATCH', '/api/me', 400, { name: '   ' })
    await client.json('PATCH', '/api/me', 400, { name: 'x'.repeat(25) })
    await client.json('PATCH', '/api/me', 400, { name: 42 })
    await client.json('PATCH', '/api/me', 400, { name: 'bad\u0000name' })
    const { user } = await client.json('PATCH', '/api/me', 200, { name: ' Sammy ' })
    expect(user.name).toBe('Sammy')
    await new Client(ctx.app).json('PATCH', '/api/me', 401, { name: 'x' })
  })
})
