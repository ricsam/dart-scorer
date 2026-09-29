import { createRemoteJWKSet, jwtVerify } from 'jose'

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

/** Claims of a Google ID token whose signature, issuer, audience and expiry have been verified. */
export type GoogleIdentity = {
  sub: string
  email: string | null
  emailVerified: boolean
  name: string | null
  givenName: string | null
  picture: string | null
  nonce: string | null
}

/** Talks to Google on behalf of the callback route. Injected so tests never reach the network. */
export interface GoogleClient {
  /** Exchanges an authorization code (with its PKCE verifier) and returns the verified ID token claims. */
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<GoogleIdentity>
}

function stringClaim(value: unknown) {
  return typeof value === 'string' && value !== '' ? value : null
}

export function createGoogleClient(options: { clientId: string; clientSecret: string; timeoutMs?: number }): GoogleClient {
  const jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL))
  const timeoutMs = options.timeoutMs ?? 10_000

  return {
    async exchangeCode({ code, codeVerifier, redirectUri }) {
      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      // Never include the response body in errors: keep token material out of logs.
      if (!response.ok) throw new Error(`Google token endpoint responded with HTTP ${response.status}`)
      const tokens = await response.json() as { id_token?: unknown }
      if (typeof tokens.id_token !== 'string') throw new Error('Google token response did not include an id_token')

      const { payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: options.clientId,
        clockTolerance: 60,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'sub'],
      })
      const sub = stringClaim(payload.sub)
      if (!sub) throw new Error('Google ID token has no subject')
      return {
        sub,
        email: stringClaim(payload.email),
        emailVerified: payload.email_verified === true || payload.email_verified === 'true',
        name: stringClaim(payload.name),
        givenName: stringClaim(payload.given_name),
        picture: stringClaim(payload.picture),
        nonce: stringClaim(payload.nonce),
      }
    },
  }
}
