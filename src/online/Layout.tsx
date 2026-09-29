import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BarChart3, ChevronDown, LogIn, LogOut, Moon, Sun, Target, Users } from 'lucide-react'
import { Brand } from '../ui/Brand'
import { useTheme } from '../ui/useTheme'
import { Link, useRouter } from './router'
import { useSession } from './session'
import { Avatar } from './ui'
import { errorMessage } from './api'

export function SignInAction() {
  return (
    <Link to="/login" className="icon-button account-button" aria-label="Sign in for rooms and leaderboards">
      <LogIn size={17} /><span>SIGN IN</span>
    </Link>
  )
}

export function RoomsAction() {
  const { user } = useSession()
  return (
    <Link to="/" className="icon-button account-button signed-in" aria-label="Back to your rooms">
      {user && <Avatar user={user} size={20} />}<span>ROOMS</span>
    </Link>
  )
}

export function OnlineInvite({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="settings-section online-invite">
      <div className="settings-copy">
        <strong><Users size={14} /> Play with your crew</strong>
        <span>Sign in with Google to create rooms, invite friends, score matches live and keep leaderboards.</span>
      </div>
      <button className="add-player" onClick={onSignIn}><LogIn size={16} /> SIGN IN</button>
    </div>
  )
}

export function OnlineLayout({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const [theme, setTheme] = useTheme()
  const { user } = useSession()
  const { path } = useRouter()

  return (
    <div className={`app-shell ${theme} online-shell`}>
      <header className="topbar online-topbar">
        <Link to="/" className="brand-link" aria-label="Oche home"><Brand /></Link>
        {user && !bare ? (
          <nav className="online-nav" aria-label="Main">
            <Link to="/" className={path === '/' || path.startsWith('/rooms') ? 'active' : ''}><Users size={15} /> ROOMS</Link>
            <Link to="/play"><Target size={15} /> QUICK GAME</Link>
            <Link to="/me" className={path === '/me' ? 'active' : ''}><BarChart3 size={15} /> MY STATS</Link>
          </nav>
        ) : <span />}
        <div className="header-actions">
          {user ? <UserMenu theme={theme} onTheme={setTheme} /> : (
            <>
              <button className="icon-button theme-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
                {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              </button>
              {path !== '/login' && <SignInAction />}
            </>
          )}
        </div>
      </header>
      <main className="online-main">{children}</main>
      <footer className="online-footer">
        <span>OCHE</span><i /> <Link to="/privacy">PRIVACY</Link><i /> <a href="https://github.com/ricsam/dart-scorer" target="_blank" rel="noreferrer">OPEN SOURCE</a>
      </footer>
    </div>
  )
}

function UserMenu({ theme, onTheme }: { theme: 'light' | 'dark'; onTheme: (theme: 'light' | 'dark') => void }) {
  const { user, signOut } = useSession()
  const { navigate } = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null
  const go = (to: string) => { setOpen(false); navigate(to) }

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-menu-button" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${user.name}`}>
        <Avatar user={user} size={26} />
        <span>{user.name}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-identity">
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
          <button role="menuitem" onClick={() => go('/')}><Users size={15} /> Rooms</button>
          <button role="menuitem" onClick={() => go('/play')}><Target size={15} /> Quick game</button>
          <button role="menuitem" onClick={() => go('/me')}><BarChart3 size={15} /> My stats</button>
          <button role="menuitem" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />} {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <button role="menuitem" className="danger" onClick={async () => { try { await signOut(); setOpen(false); navigate('/') } catch (caught) { setError(errorMessage(caught)) } }}><LogOut size={15} /> Sign out</button>
          {error && <p role="alert" className="form-error">{error}</p>}
        </div>
      )}
    </div>
  )
}
