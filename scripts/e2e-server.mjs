// Each run owns only its fresh directory; concurrent runs never delete another database.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

mkdirSync('.e2e', { recursive: true })
const dataDir = mkdtempSync(resolve('.e2e/run-'))
writeFileSync(join(dataDir, 'manifest.json'), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), dataDir }))
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: process.env.E2E_API_PORT ?? '8790',
    PUBLIC_URL: process.env.E2E_PUBLIC_URL ?? 'http://127.0.0.1:4180',
    DATABASE_PATH: join(dataDir, 'oche.db'),
    STATIC_DIR: '',
    DEV_LOGIN: 'true',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    // Every browser in the suite signs in from 127.0.0.1; keep the per-IP auth limit out of the way.
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  },
})
const stop = () => child.kill('SIGTERM')
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', (code) => {
  rmSync(dataDir, { recursive: true, force: true })
  process.exit(code ?? 0)
})
