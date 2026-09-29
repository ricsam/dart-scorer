import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono } from 'hono'
import type { AppEnv, Logger } from './context'

export function isReservedPath(path: string) {
  return path === '/api' || path.startsWith('/api/')
    || path === '/auth' || path.startsWith('/auth/')
    || path === '/healthz' || path === '/readyz'
}

/**
 * Serves the built SPA: hashed `/assets/*` are cached forever, everything else revalidates,
 * and unknown GET paths fall back to `index.html` so client-side routes work on reload.
 * Returns false (and mounts nothing) when the directory does not exist.
 */
export function mountStatic(app: Hono<AppEnv>, staticDir: string, logger: Logger) {
  const root = resolve(staticDir)
  const indexPath = join(root, 'index.html')
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    logger.warn(`STATIC_DIR ${root} does not exist; not serving the web app.`)
    return false
  }
  if (!existsSync(indexPath)) logger.warn(`STATIC_DIR ${root} has no index.html; client routes will 404.`)

  const files = serveStatic<AppEnv>({ root })
  const cacheControl = (path: string) => {
    if (path.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
    if (path.endsWith('/') || path.endsWith('.html')) return 'no-cache'
    return 'public, max-age=3600'
  }

  app.use('*', async (c, next) => {
    if ((c.req.method !== 'GET' && c.req.method !== 'HEAD') || isReservedPath(c.req.path)) return next()
    // serveStatic returns the file response itself, or calls next() when there is no such file.
    const response = await files(c, next)
    if (response instanceof Response && response.status < 400) response.headers.set('Cache-Control', cacheControl(c.req.path))
    return response
  })

  app.use('*', async (c, next) => {
    if ((c.req.method !== 'GET' && c.req.method !== 'HEAD') || isReservedPath(c.req.path) || c.req.path.startsWith('/assets/')) return next()
    let html: string
    try {
      html = await readFile(indexPath, 'utf8')
    } catch {
      return next()
    }
    c.header('Cache-Control', 'no-cache')
    return c.html(c.req.method === 'HEAD' ? '' : html)
  })
  return true
}
