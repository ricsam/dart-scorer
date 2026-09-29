import { timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppEnv, Services, UserRow } from './context'
import { nowIso } from './context'
import { GOOGLE_AUTHORIZE_URL } from './google'
import { badRequest, expectObject, expectText, notFound, readJson, unauthorized } from './http'
import { randomToken, sha256Base64Url, sha256Hex } from './ids'
import { defaultDisplayName, toUser, upsertIdentity, USER_NAME_MAX_LENGTH } from './users'

const DAY_MS = 24 * 60 * 60 * 1000
export const SESSION_TTL_MS = 60 * DAY_MS
/** Sessions used with less than this left are extended to a fresh `SESSION_TTL_MS`. */
export const SESSION_RENEW_BELOW_MS = 30 * DAY_MS
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

export function sessionCookieName(services: Pick<Services, 'config'>) {
  return services.config.secure ? '__Host-oche_session' : 'oche_session'
}

export function oauthCookieName(services: Pick<Services, 'config'>) {
  return services.config.secure ? '__Secure-oche_oauth_state' : 'oche_oauth_state'
}

function setSessionCookie(c: Context, services: Services, token: string, expiresAt: Date) {
  setCookie(c, sessionCookieName(services), token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: services.config.secure,
    path: '/',
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - services.now().getTime()) / 1000)),
  })
}

function clearSessionCookie(c: Context, services: Services) {
  deleteCookie(c, sessionCookieName(services), { path: '/', secure: services.config.secure, httpOnly: true, sameSite: 'Lax' })
}

/** Creates a session for `userId`, sets its cookie and purges expired sessions. */
export function startSession(c: Context, services: Services, userId: string) {
  const { db } = services
  const now = services.now()
  const token = randomToken(32)
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)
  db.run('DELETE FROM sessions WHERE expires_at <= ?', now.toISOString())
  db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', sha256Hex(token), userId, now.toISOString(), expiresAt.toISOString())
  setSessionCookie(c, services, token, expiresAt)
}

/** Resolves the signed-in user (if any) into `c.var.user`, renewing sessions that are getting old. */
export function sessionMiddleware(services: Services): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('user', null)
    c.set('sessionHash', null)
    const token = getCookie(c, sessionCookieName(services))
    if (token) {
      const hash = /^[A-Za-z0-9_-]{16,128}$/.test(token) ? sha256Hex(token) : null
      const row = hash
        ? services.db.get<UserRow & { session_expires_at: string }>(
          'SELECT u.*, s.expires_at AS session_expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
          hash,
        )
        : undefined
      const now = services.now()
      if (!row || !hash) {
        clearSessionCookie(c, services)
      } else if (Date.parse(row.session_expires_at) <= now.getTime()) {
        services.db.run('DELETE FROM sessions WHERE token_hash = ?', hash)
        clearSessionCookie(c, services)
      } else {
        const { session_expires_at: expiresAt, ...user } = row
        if (Date.parse(expiresAt) - now.getTime() < SESSION_RENEW_BELOW_MS) {
          const renewed = new Date(now.getTime() + SESSION_TTL_MS)
          services.db.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', renewed.toISOString(), hash)
          setSessionCookie(c, services, token, renewed)
        }
        c.set('user', user)
        c.set('sessionHash', hash)
      }
    }
    await next()
  }
}

export function requireUser(c: Context<AppEnv>): UserRow {
  const user = c.get('user')
  if (!user) throw unauthorized()
  return user
}

/** Only same-origin relative paths (`/something`), never `//host` or backslash tricks. */
export function sanitizeReturnTo(value: string | undefined | null): string {
  if (!value || value.length > 1024) return '/'
  // eslint-disable-next-line no-control-regex
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f\s]/.test(value)) return '/'
  try {
    const base = 'http://oche.invalid'
    const url = new URL(value, base)
    if (url.origin !== base) return '/'
    const path = `${url.pathname}${url.search}${url.hash}`
    return path.startsWith('/') && !path.startsWith('//') ? path : '/'
  } catch {
    return '/'
  }
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/

export function authRoutes(services: Services) {
  const { db, config, logger } = services
  const app = new Hono<AppEnv>()
  const redirectUri = `${config.publicUrl}/auth/google/callback`

  app.get('/google', (c) => {
    if (!config.google || !services.google) return c.redirect('/login?error=google_unavailable', 302)
    const returnTo = sanitizeReturnTo(c.req.query('returnTo'))
    const state = randomToken(32)
    const codeVerifier = randomToken(32)
    const nonce = randomToken(16)
    const now = services.now()
    db.run('DELETE FROM oauth_states WHERE created_at < ?', new Date(now.getTime() - OAUTH_STATE_TTL_MS).toISOString())
    db.run(
      'INSERT INTO oauth_states (state, code_verifier, nonce, return_to, created_at) VALUES (?, ?, ?, ?, ?)',
      state, codeVerifier, nonce, returnTo, now.toISOString(),
    )
    setCookie(c, oauthCookieName(services), state, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.secure,
      path: '/auth',
      maxAge: OAUTH_STATE_TTL_MS / 1000,
    })
    const url = new URL(GOOGLE_AUTHORIZE_URL)
    url.search = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: sha256Base64Url(codeVerifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString()
    return c.redirect(url.toString(), 302)
  })

  app.get('/google/callback', async (c) => {
    const fail = (code: string) => {
      deleteCookie(c, oauthCookieName(services), { path: '/auth', secure: config.secure, httpOnly: true, sameSite: 'Lax' })
      return c.redirect(`/login?error=${code}`, 302)
    }
    const cookieState = getCookie(c, oauthCookieName(services))
    const state = c.req.query('state')
    const stateMatches = !!state && !!cookieState && state.length <= 128 && safeEqual(state, cookieState)
    const consumeState = () => {
      if (!stateMatches) return undefined
      const row = db.get<{ code_verifier: string; nonce: string; return_to: string; created_at: string }>(
        'SELECT code_verifier, nonce, return_to, created_at FROM oauth_states WHERE state = ?', state,
      )
      if (row) db.run('DELETE FROM oauth_states WHERE state = ?', state)
      return row
    }

    const error = c.req.query('error')
    if (error !== undefined) {
      consumeState()
      return fail(error === 'access_denied' ? 'access_denied' : 'google_failed')
    }
    if (!config.google || !services.google) return fail('google_unavailable')
    if (!stateMatches) return fail('state_mismatch')
    const saved = consumeState()
    if (!saved || services.now().getTime() - Date.parse(saved.created_at) > OAUTH_STATE_TTL_MS) return fail('state_expired')
    const code = c.req.query('code')
    if (!code || code.length > 2048) return fail('invalid_request')

    let identity
    try {
      identity = await services.google.exchangeCode({ code, codeVerifier: saved.code_verifier, redirectUri })
    } catch {
      logger.warn('Google sign-in failed: token exchange or verification failed')
      return fail('google_failed')
    }
    if (!identity.nonce || !safeEqual(identity.nonce, saved.nonce)) {
      logger.warn('Google sign-in failed: nonce mismatch')
      return fail('google_failed')
    }
    if (!identity.email || !identity.emailVerified) return fail('email_unverified')

    const picture = identity.picture && identity.picture.startsWith('https://') && identity.picture.length <= 2048 ? identity.picture : null
    const user = upsertIdentity(db, {
      subject: identity.sub,
      email: identity.email.slice(0, 320),
      name: defaultDisplayName([identity.givenName, identity.name], identity.email),
      avatarUrl: picture,
      now: nowIso(services),
    })
    startSession(c, services, user.id)
    deleteCookie(c, oauthCookieName(services), { path: '/auth', secure: config.secure, httpOnly: true, sameSite: 'Lax' })
    return c.redirect(sanitizeReturnTo(saved.return_to), 302)
  })

  app.post('/logout', (c) => {
    const hash = c.get('sessionHash')
    if (hash) {
      db.run('DELETE FROM sessions WHERE token_hash = ?', hash)
      services.hub.closeSession(hash)
    }
    clearSessionCookie(c, services)
    return c.body(null, 204)
  })

  app.post('/dev-login', async (c) => {
    if (!config.devLogin) throw notFound()
    const body = expectObject(await readJson(c))
    const name = expectText(body.name, 'Name', 1, USER_NAME_MAX_LENGTH)
    const email = expectText(body.email, 'Email', 3, 254).toLowerCase()
    if (!EMAIL_PATTERN.test(email)) throw badRequest('Email is not valid.')
    const user = upsertIdentity(db, { subject: `dev:${email}`, email, name, avatarUrl: null, now: nowIso(services) })
    startSession(c, services, user.id)
    return c.json({ user: toUser(user) })
  })

  return app
}
