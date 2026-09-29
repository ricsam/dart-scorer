// Runs the API server and the online edition's Vite dev server together.
// The browser talks to Vite (http://localhost:5173), which proxies /api and /auth to the server.
import { spawn } from 'node:child_process'

const serverPort = process.env.SERVER_PORT ?? '8787'
const webPort = process.env.WEB_PORT ?? '5173'
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${webPort}`

const children = [
  spawn(process.execPath, ['--watch', '--watch-preserve-output', '--import', 'tsx', 'server/index.ts'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: serverPort,
      HOST: '127.0.0.1',
      PUBLIC_URL: publicUrl,
      DEV_LOGIN: process.env.DEV_LOGIN ?? 'true',
      DATABASE_PATH: process.env.DATABASE_PATH ?? 'data/oche-dev.db',
      STATIC_DIR: '',
    },
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'online', '--port', webPort, '--strictPort'], {
    stdio: 'inherit',
    env: { ...process.env, SERVER_PORT: serverPort },
  }),
]

const stop = (code = 0) => {
  for (const child of children) child.kill('SIGTERM')
  process.exit(code)
}

for (const child of children) child.on('exit', (code) => stop(code ?? 0))
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
