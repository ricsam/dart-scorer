import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGoogleClient, GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL } from '../../server/google'

/** Exercises the real client against a stubbed Google (token endpoint + JWKS), with no network. */
async function fakeGoogle(claims: Record<string, unknown>, options: { status?: number; omit?: string; alg?: string } = {}) {
  const alg = options.alg ?? 'RS256'
  const { publicKey, privateKey } = await generateKeyPair(alg)
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg, use: 'sig' }
  const payload = { ...claims, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 }
  if (options.omit) delete (payload as Record<string, unknown>)[options.omit]
  const idToken = await new SignJWT(payload)
    .setProtectedHeader({ alg, kid: 'test-key' })
    .sign(privateKey)
  const requests: { url: string; body: string | null }[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    requests.push({ url, body: init?.body ? String(init.body) : null })
    if (url === GOOGLE_TOKEN_URL) {
      return new Response(JSON.stringify({ id_token: idToken, access_token: 'unused' }), { status: options.status ?? 200, headers: { 'content-type': 'application/json' } })
    }
    if (url === GOOGLE_JWKS_URL) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } })
    return new Response('not found', { status: 404 })
  })
  return requests
}

const baseClaims = {
  iss: 'https://accounts.google.com',
  aud: 'client-123',
  sub: '1234567890',
  email: 'alex@example.com',
  email_verified: true,
  name: 'Alex Example',
  given_name: 'Alex',
  picture: 'https://lh3.googleusercontent.com/a/x',
  nonce: 'nonce-1',
}

describe('Google client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exchanges the code with PKCE and verifies the ID token', async () => {
    const requests = await fakeGoogle(baseClaims)
    const client = createGoogleClient({ clientId: 'client-123', clientSecret: 'secret-abc' })
    const identity = await client.exchangeCode({ code: 'the-code', codeVerifier: 'the-verifier', redirectUri: 'https://oche.example/auth/google/callback' })
    expect(identity).toEqual({
      sub: '1234567890',
      email: 'alex@example.com',
      emailVerified: true,
      name: 'Alex Example',
      givenName: 'Alex',
      picture: 'https://lh3.googleusercontent.com/a/x',
      nonce: 'nonce-1',
    })
    const tokenRequest = new URLSearchParams(requests.find((request) => request.url === GOOGLE_TOKEN_URL)!.body!)
    expect(Object.fromEntries(tokenRequest)).toEqual({
      client_id: 'client-123',
      client_secret: 'secret-abc',
      code: 'the-code',
      code_verifier: 'the-verifier',
      grant_type: 'authorization_code',
      redirect_uri: 'https://oche.example/auth/google/callback',
    })
  })

  it.each(['exp', 'iat', 'sub'])('requires the %s claim', async (omit) => {
    await fakeGoogle(baseClaims, { omit })
    await expect(createGoogleClient({ clientId: 'client-123', clientSecret: 's' }).exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' })).rejects.toThrow()
  })

  it('rejects a valid non-RS256 signature', async () => {
    await fakeGoogle(baseClaims, { alg: 'ES256' })
    await expect(createGoogleClient({ clientId: 'client-123', clientSecret: 's' }).exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' })).rejects.toThrow()
  })

  it('accepts the bare issuer form', async () => {
    await fakeGoogle({ ...baseClaims, iss: 'accounts.google.com' })
    const client = createGoogleClient({ clientId: 'client-123', clientSecret: 's' })
    await expect(client.exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' })).resolves.toMatchObject({ sub: '1234567890' })
  })

  it('rejects tokens for another audience or issuer, and failed exchanges', async () => {
    await fakeGoogle({ ...baseClaims, aud: 'someone-else' })
    await expect(createGoogleClient({ clientId: 'client-123', clientSecret: 's' }).exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' })).rejects.toThrow()
    vi.unstubAllGlobals()

    await fakeGoogle({ ...baseClaims, iss: 'https://evil.example' })
    await expect(createGoogleClient({ clientId: 'client-123', clientSecret: 's' }).exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' })).rejects.toThrow()
    vi.unstubAllGlobals()

    await fakeGoogle(baseClaims, { status: 400 })
    await expect(createGoogleClient({ clientId: 'client-123', clientSecret: 's' }).exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' })).rejects.toThrow('HTTP 400')
  })
})
