import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BarChart3, ChevronDown, LogIn, LogOut, Moon, Pencil, Sun, Target, Users } from 'lucide-react'
import { Brand } from '../ui/Brand'
import { useTheme } from '../ui/useTheme'
import { Link, useRouter } from './router'
import { useSession } from './session'
import { Avatar } from './ui'
import { errorMessage } from './api'
import { ConfirmDialog } from '../ui/ConfirmDialog'

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
            {!user.guest && <Link to="/me" className={path === '/me' ? 'active' : ''}><BarChart3 size={15} /> MY STATS</Link>}
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
  const { navigate, path } = useRouter()
  const [confirmSignOut, setConfirmSignOut] = useState(false)
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
  const leaveSession = async () => {
    try { await signOut(); setOpen(false); setConfirmSignOut(false); navigate('/') } catch (caught) { setError(errorMessage(caught)) }
  }

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
            <small>{user.guest ? 'Guest · unranked' : user.email}</small>
          </div>
          <button role="menuitem" onClick={() => go('/')}><Users size={15} /> Rooms</button>
          <button role="menuitem" onClick={() => go('/play')}><Target size={15} /> Quick game</button>
          {user.guest
            ? <button role="menuitem" onClick={() => go(`/login?returnTo=${encodeURIComponent(path)}`)}><LogIn size={15} /> Sign in for an account</button>
            : <>
              <button role="menuitem" onClick={() => go('/me')}><BarChart3 size={15} /> My stats</button>
              <button role="menuitem" onClick={() => go('/me')}><Pencil size={15} /> Edit dart nickname</button>
            </>}
          <button role="menuitem" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />} {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <button role="menuitem" className="danger" onClick={() => { if (user.guest) { setOpen(false); setConfirmSignOut(true) } else { void leaveSession() } }}><LogOut size={15} /> {user.guest ? 'End guest session' : 'Sign out'}</button>
          {error && <p role="alert" className="form-error">{error}</p>}
        </div>
      )}
      {confirmSignOut && <ConfirmDialog icon={<LogOut size={30} />} eyebrow="GUEST SESSION" title="End your guest session?" titleId="guest-signout-title" confirmLabel="END SESSION" onCancel={() => setConfirmSignOut(false)} onConfirm={leaveSession}>
        You cannot recover this guest identity by name after signing out. Your matches will stay in the room’s history.
        {error && <p role="alert">{error}</p>}
      </ConfirmDialog>}
    </div>
  )
}
