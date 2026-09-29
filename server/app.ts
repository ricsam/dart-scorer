import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { authRoutes, sessionMiddleware } from './auth'
import type { Config } from './config'
import { DEFAULT_LIMITS, type AppEnv, type Clock, type Limits, type Logger, type Services } from './context'
import type { Db } from './db'
import { createGoogleClient, type GoogleClient } from './google'
import { ApiException, errorResponse, type ApiErrorCode } from './http'
import { LiveHub } from './live'
import { matchRoutes } from './matches'
import { meRoutes } from './me'
import { roomRoutes } from './rooms'
import { assertRateLimit, clientIp, isMutating, originGuard, RateLimiter, securityHeaders } from './security'
import { mountStatic } from './static'
import { statsRoutes } from './stats'

export type AppDeps = {
  db: Db
  config: Config
  /** Defaults to the real Google client when Google credentials are configured; pass a fake in tests. */
  google?: GoogleClient | null
  now?: Clock
  logger?: Logger
  hub?: LiveHub
  limits?: Partial<Limits>
  /** Log one line per /api and /auth request (method, path, status, duration — never query strings). */
  accessLog?: boolean
}

export type App = Hono<AppEnv> & { services: Services }

const STATUS_CODES: Partial<Record<number, ApiErrorCode>> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'bad_request',
  415: 'bad_request',
  429: 'rate_limited',
}

function isApiPath(path: string) {
  return path === '/api' || path.startsWith('/api/') || path === '/auth' || path.startsWith('/auth/')
}

export function createApp(deps: AppDeps): App {
  const { db, config } = deps
  const now = deps.now ?? (() => new Date())
  const logger = deps.logger ?? console
  const limits = { ...DEFAULT_LIMITS, ...deps.limits }
  const google = deps.google !== undefined
    ? deps.google
    : config.google ? createGoogleClient(config.google) : null

  const services: Services = {
    db,
    config,
    google,
    now,
    logger,
    hub: deps.hub ?? new LiveHub(),
    limits,
    authLimiter: new RateLimiter(limits.authPerMinute, 60_000, now),
    mutationLimiter: new RateLimiter(limits.mutationsPerMinute, 60_000, now),
  }

  const inviteLimiter = new RateLimiter(60, 60_000, now)
  // Log route templates only: unknown paths may themselves contain credentials.
  const logRoute = (c: import('hono').Context) => c.req.routePath || '[unmatched]'
  const app = new Hono<AppEnv>()

  if (deps.accessLog) {
    app.use('*', async (c, next) => {
      const started = performance.now()
      await next()
      if (isApiPath(c.req.path)) logger.info(`${c.req.method} ${logRoute(c)} ${c.res.status} ${Math.round(performance.now() - started)}ms`)
    })
  }
  app.use('*', securityHeaders(config))

  app.get('/healthz', (c) => c.text('ok'))
  app.get('/readyz', (c) => {
    try {
      db.get('SELECT 1 AS ok')
      return c.text('ok')
    } catch {
      return c.text('database unavailable', 503)
    }
  })

  app.use('/api/*', originGuard(config))
  app.use('/auth/*', originGuard(config))
  app.use('/auth/*', async (c, next) => {
    assertRateLimit(services.authLimiter, clientIp(c, config.trustProxy))
    await next()
  })
  app.use('/api/*', sessionMiddleware(services))
  app.use('/auth/*', sessionMiddleware(services))
  app.use('/api/*', async (c, next) => {
    const user = c.get('user')
    if (user && isMutating(c.req.method)) assertRateLimit(services.mutationLimiter, user.id)
    await next()
  })

  app.use('/api/invites/*', async (c, next) => {
    if (c.req.method === 'GET') assertRateLimit(inviteLimiter, clientIp(c, config.trustProxy))
    await next()
  })

  app.route('/auth', authRoutes(services))
  const api = new Hono<AppEnv>()
  api.route('/', meRoutes(services))
  api.route('/', roomRoutes(services))
  api.route('/', matchRoutes(services))
  api.route('/', statsRoutes(services))
  app.route('/api', api)
  app.all('/api/*', (c) => errorResponse(c, 404, 'not_found', 'Unknown API endpoint.'))
  app.all('/auth/*', (c) => errorResponse(c, 404, 'not_found', 'Not found.'))

  if (config.staticDir) mountStatic(app, config.staticDir, logger)

  app.notFound((c) => (isApiPath(c.req.path)
    ? errorResponse(c, 404, 'not_found', 'Not found.')
    : c.text('Not found', 404)))

  app.onError((err, c) => {
    if (err instanceof ApiException) return errorResponse(c, err.status, err.code, err.message, err.extra)
    if (err instanceof HTTPException && err.status < 500) {
      const status = err.status as ContentfulStatusCode
      return errorResponse(c, status, STATUS_CODES[status] ?? 'bad_request', err.message || 'Bad request.')
    }
    // Exception messages/stacks may contain provider response bodies or tokens.
    logger.error(`Unhandled server error on ${c.req.method} ${logRoute(c)}`)
    return errorResponse(c, 500, 'server_error', 'Something went wrong. Please try again.')
  })

  return Object.assign(app, { services })
}
