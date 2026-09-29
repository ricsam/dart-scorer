import type { Context, MiddlewareHandler } from 'hono'
import type { Config } from './config'
import type { Clock } from './context'
import { ApiException, BODY_LIMIT_BYTES, errorResponse } from './http'

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://*.googleusercontent.com",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isMutating(method: string) {
  return MUTATING_METHODS.has(method.toUpperCase())
}

/** Adds security headers to every response (and a CSP to HTML). */
export function securityHeaders(config: Config): MiddlewareHandler {
  return async (c, next) => {
    await next()
    let headers = c.res.headers
    try {
      headers.set('X-Content-Type-Options', 'nosniff')
    } catch {
      // Immutable headers (e.g. a proxied Response): copy it once.
      c.res = new Response(c.res.body, c.res)
      headers = c.res.headers
      headers.set('X-Content-Type-Options', 'nosniff')
    }
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    headers.set('X-Frame-Options', 'DENY')
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if (config.secure) headers.set('Strict-Transport-Security', 'max-age=31536000')
    if ((headers.get('Content-Type') ?? '').toLowerCase().startsWith('text/html')) {
      headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    }
    const path = c.req.path
    if ((path.startsWith('/api/') || path.startsWith('/auth/')) && !headers.has('Cache-Control')) {
      headers.set('Cache-Control', 'no-store')
    }
  }
}

function requestHasBody(c: Context) {
  const length = c.req.header('content-length')
  if (length !== undefined) return Number(length) > 0
  return c.req.header('transfer-encoding') !== undefined || c.req.raw.body !== null
}

/**
 * CSRF defence for cookie-authenticated mutations: the Origin (when sent) must be ours,
 * and bodies must be JSON (which a cross-site HTML form cannot produce).
 */
export function originGuard(config: Config): MiddlewareHandler {
  return async (c, next) => {
    if (!isMutating(c.req.method)) return next()
    const origin = c.req.header('origin')
    if (origin !== undefined && origin !== config.publicOrigin) {
      return errorResponse(c, 403, 'forbidden', 'Cross-origin request rejected.')
    }
    if (origin === undefined && c.req.header('sec-fetch-site') === 'cross-site') {
      return errorResponse(c, 403, 'forbidden', 'Cross-site request rejected.')
    }
    if (requestHasBody(c)) {
      const mediaType = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return errorResponse(c, 415, 'bad_request', 'Request body must be application/json.')
      }
      const length = c.req.header('content-length')
      if (length !== undefined && Number(length) > BODY_LIMIT_BYTES) {
        return errorResponse(c, 413, 'bad_request', 'Request body is too large.')
      }
    }
    return next()
  }
}

/** Client IP for rate limiting. Proxy headers are only trusted when configured. */
export function clientIp(c: Context, trustProxy: boolean) {
  if (trustProxy) {
    const cloudflare = c.req.header('cf-connecting-ip')?.trim()
    if (cloudflare) return cloudflare
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  return env?.incoming?.socket?.remoteAddress ?? 'unknown'
}

/** Fixed-window in-memory counter (single process). */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>()
  private lastSweep = 0
  private readonly limit: number
  private readonly windowMs: number
  private readonly now: Clock

  constructor(limit: number, windowMs: number, now: Clock) {
    this.limit = limit
    this.windowMs = windowMs
    this.now = now
  }

  /** Counts one request; returns false when the key is over its limit. */
  hit(key: string): boolean {
    const time = this.now().getTime()
    if (time - this.lastSweep > this.windowMs) {
      for (const [entryKey, entry] of this.windows) if (time - entry.start >= this.windowMs) this.windows.delete(entryKey)
      this.lastSweep = time
    }
    const entry = this.windows.get(key)
    if (!entry || time - entry.start >= this.windowMs) {
      // Fail closed instead of allocating unbounded keys during an IP-flood.
      if (!entry && this.windows.size >= 10_000) return false
      this.windows.set(key, { start: time, count: 1 })
      return true
    }
    entry.count += 1
    return entry.count <= this.limit
  }
}

export function assertRateLimit(limiter: RateLimiter, key: string) {
  if (!limiter.hit(key)) throw new ApiException(429, 'rate_limited', 'Too many requests. Try again in a minute.')
}
