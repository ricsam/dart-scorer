import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// `vite` / `vite build` produce the standalone edition (GitHub Pages).
// `--mode online` produces the signed-in edition served by the Node server (see server/).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const online = mode === 'online'
  const serverPort = env.SERVER_PORT ?? '8787'
  const serverTarget = `http://127.0.0.1:${serverPort}`

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_EDITION': JSON.stringify(online ? 'online' : 'standalone'),
    },
    build: {
      outDir: online ? 'dist-online' : 'dist',
    },
    server: online ? {
      proxy: {
        '/api': { target: serverTarget, changeOrigin: false },
        '/auth': { target: serverTarget, changeOrigin: false },
      },
    } : undefined,
  }
})
