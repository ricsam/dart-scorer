/** Server configuration, read once from the environment at startup. */
export type Config = {
  port: number
  host: string
  production: boolean
  /** Browser-facing URL without trailing slash, e.g. `https://oche.example`. */
  publicUrl: string
  /** `new URL(publicUrl).origin`, compared against the `Origin` header of mutating requests. */
  publicOrigin: string
  /** True when the public URL is https: cookies get `Secure` and HSTS is sent. */
  secure: boolean
  databasePath: string
  /** Directory of the built online SPA, or null to disable static serving. */
  staticDir: string | null
  google: { clientId: string; clientSecret: string } | null
  /** `POST /auth/dev-login` — never enabled in production. */
  devLogin: boolean
  /** Derive the client IP from `CF-Connecting-IP` / `X-Forwarded-For`. */
  trustProxy: boolean
}

export type ConfigWarning = string

function parsePort(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === '') return fallback
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid PORT: ${value}`)
  return port
}

function flag(value: string | undefined) {
  return value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export function loadConfig(env: Record<string, string | undefined> = process.env): { config: Config; warnings: ConfigWarning[] } {
  const warnings: ConfigWarning[] = []
  const production = env.NODE_ENV === 'production'

  const rawPublicUrl = (env.PUBLIC_URL ?? '').trim() || 'http://localhost:5173'
  let publicOrigin: string
  try {
    const url = new URL(rawPublicUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol')
    publicOrigin = url.origin
  } catch {
    throw new Error(`Invalid PUBLIC_URL: ${rawPublicUrl}`)
  }
  if (production && !publicOrigin.startsWith('https:')) warnings.push('PUBLIC_URL is not https in production; cookies will not be Secure.')

  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? ''
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? ''
  const google = clientId && clientSecret ? { clientId, clientSecret } : null
  if (!google && (clientId || clientSecret)) warnings.push('Google sign-in is disabled: set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.')

  let devLogin = flag(env.DEV_LOGIN)
  if (devLogin && production) {
    warnings.push('DEV_LOGIN is ignored because NODE_ENV=production.')
    devLogin = false
  } else if (devLogin) {
    warnings.push('DEV_LOGIN is enabled: anyone can sign in as any email via POST /auth/dev-login. Never enable this on a public server.')
  }

  const staticDir = env.STATIC_DIR === undefined ? 'dist-online' : env.STATIC_DIR.trim()

  return {
    config: {
      port: parsePort(env.PORT, 8787),
      host: (env.HOST ?? '').trim() || '0.0.0.0',
      production,
      publicUrl: publicOrigin,
      publicOrigin,
      secure: publicOrigin.startsWith('https:'),
      databasePath: (env.DATABASE_PATH ?? '').trim() || 'data/oche.db',
      staticDir: staticDir === '' ? null : staticDir,
      google,
      devLogin,
      trustProxy: flag(env.TRUST_PROXY),
    },
    warnings,
  }
}

/**
 * Optional rate-limit overrides. `AUTH_RATE_LIMIT_PER_MINUTE` raises the per-IP `/auth` limit for
 * environments where many players share one address (such as the end-to-end test harness).
 */
export function loadLimitOverrides(env: Record<string, string | undefined> = process.env): { authPerMinute?: number } {
  const raw = env.AUTH_RATE_LIMIT_PER_MINUTE?.trim()
  if (!raw) return {}
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 100_000) throw new Error(`Invalid AUTH_RATE_LIMIT_PER_MINUTE: ${raw}`)
  return { authPerMinute: value }
}
