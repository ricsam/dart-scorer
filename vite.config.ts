import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Keep generated files flat so they can be mounted from a Kubernetes ConfigMap.
    assetsDir: '',
  },
})
