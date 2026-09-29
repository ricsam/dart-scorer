import { defineConfig } from '@playwright/test'

const STANDALONE_URL = 'http://127.0.0.1:4173'
const ONLINE_URL = 'http://127.0.0.1:4180'
const API_PORT = '8790'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 4,
  timeout: 60_000,
  use: {
    screenshot: 'only-on-failure',
    colorScheme: 'dark',
  },
  projects: [
    {
      name: 'standalone',
      testMatch: /(responsive|standalone)\.spec\.ts/,
      use: { baseURL: STANDALONE_URL },
    },
    {
      name: 'online',
      testMatch: /online\.spec\.ts/,
      use: { baseURL: ONLINE_URL },
    },
  ],
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
      url: STANDALONE_URL,
      reuseExistingServer: false,
    },
    {
      command: 'node scripts/e2e-server.mjs',
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      env: { E2E_API_PORT: API_PORT, E2E_PUBLIC_URL: ONLINE_URL },
      reuseExistingServer: false,
    },
    {
      command: 'npx vite --mode online --host 127.0.0.1 --port 4180 --strictPort',
      url: ONLINE_URL,
      env: { SERVER_PORT: API_PORT },
      reuseExistingServer: false,
    },
  ],
})
