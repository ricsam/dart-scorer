import { lazy, Suspense } from 'react'
import { LogIn } from 'lucide-react'
import { StandaloneApp } from './standalone/StandaloneApp'

// The online edition is only bundled when building with `--mode online`; the standalone
// GitHub Pages build drops this branch entirely.
const OnlineApp = import.meta.env.VITE_EDITION === 'online' ? lazy(() => import('./online/OnlineApp')) : null
const onlineUrl = import.meta.env.VITE_ONLINE_URL?.replace(/\/+$/, '')

function App() {
  if (OnlineApp) {
    return (
      <Suspense fallback={null}>
        <OnlineApp />
      </Suspense>
    )
  }

  return (
    <StandaloneApp
      accountAction={onlineUrl ? (
        <a className="icon-button account-button" href={`${onlineUrl}/login`} aria-label="Sign in for rooms and leaderboards">
          <LogIn size={17} /><span>SIGN IN</span>
        </a>
      ) : undefined}
    />
  )
}

export default App
