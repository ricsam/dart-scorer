/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `standalone` for the GitHub Pages build, `online` for the signed-in edition served by the Node server. */
  readonly VITE_EDITION: 'standalone' | 'online'
  /** Absolute URL of the signed-in edition, linked from the standalone build (optional). */
  readonly VITE_ONLINE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
