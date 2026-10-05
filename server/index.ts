import { serve } from '@hono/node-server'
import { createApp } from './app'
import { loadConfig, loadLimitOverrides } from './config'
import { openDatabase } from './db'

function main() {
  const { config, warnings } = loadConfig()
  for (const warning of warnings) console.warn(`[oche] ${warning}`)

  const db = openDatabase(config.databasePath)
  const app = createApp({ db, config, accessLog: true, limits: loadLimitOverrides() })
  app.services.janitor.start()

  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.log(`[oche] listening on http://${info.address}:${info.port} (public URL ${config.publicUrl})`)
    console.log(`[oche] database ${config.databasePath}; Google sign-in ${config.google ? 'enabled' : 'disabled'}; dev login ${config.devLogin ? 'ENABLED' : 'disabled'}`)
  })

  let stopping = false
  const shutdown = (signal: string) => {
    if (stopping) return
    stopping = true
    console.log(`[oche] ${signal} received, shutting down`)
    app.services.bots.stop()
    app.services.janitor.stop()
    app.services.hub.closeAll()
    const force = setTimeout(() => {
      console.warn('[oche] forcing shutdown after timeout')
      db.close()
      process.exit(1)
    }, 10_000)
    force.unref()
    server.close(() => {
      db.close()
      console.log('[oche] stopped')
      process.exit(0)
    })
    // Let in-flight requests finish, but don't wait on idle keep-alive sockets.
    if ('closeIdleConnections' in server) server.closeIdleConnections()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main()
