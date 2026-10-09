import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BarChart3, ChevronDown, Dumbbell, Globe2, Info, LogIn, LogOut, Moon, Pencil, Play, Sun, Users } from 'lucide-react'
import { Brand } from '../ui/Brand'
import { useTheme } from '../ui/useTheme'
import { Link, useRouter } from './router'
import { useSession } from './session'
import { Avatar } from './ui'
import { errorMessage } from './api'
import { InvitesButton } from './notifications'
import { ConfirmDialog } from '../ui/ConfirmDialog'

export function SignInAction() {
  return (
    <Link to="/login" className="icon-button account-button" aria-label="Sign in to play online">
      <LogIn size={17} /><span>SIGN IN</span>
    </Link>
  )
}

export function OnlineInvite({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="settings-section online-invite">
      <div className="settings-copy">
        <strong><Users size={14} /> Play online</strong>
        <span>Sign in with Google to track your stats, challenge friends in leagues and compete in ranked games.</span>
      </div>
      <button className="add-player" onClick={onSignIn}><LogIn size={16} /> SIGN IN</button>
    </div>
  )
}

export function AboutAction() {
  return (
    <a href="/about" target="_blank" rel="noreferrer" className="icon-button account-button" aria-label="About & scoring (opens in a new tab)">
      <Info size={17} />
    </a>
  )
}

export function ScoringInfo() {
  return (
    <div className="settings-section online-info">
      <div className="settings-copy">
        <strong><Info size={14} /> About & scoring</strong>
        <span>Learn how scoring, averages, checkout rates and ratings work.</span>
      </div>
      <a href="/about" target="_blank" rel="noreferrer">READ THE GUIDE <span>(opens in a new tab)</span></a>
    </div>
  )
}

type NavItem = { to: string; label: string; icon: ReactNode; active: (path: string) => boolean; accountOnly?: boolean }

const NAV: NavItem[] = [
  { to: '/play', label: 'PLAY', icon: <Play size={15} />, active: (path) => path === '/play' || path.startsWith('/lobbies'), accountOnly: true },
  { to: '/global', label: 'GLOBAL', icon: <Globe2 size={15} />, active: (path) => path === '/global', accountOnly: true },
  { to: '/leagues', label: 'LEAGUES', icon: <Users size={15} />, active: (path) => path.startsWith('/leagues') },
  { to: '/training', label: 'TRAINING', icon: <Dumbbell size={15} />, active: (path) => path.startsWith('/training') },
  { to: '/me', label: 'STATS', icon: <BarChart3 size={15} />, active: (path) => path === '/me', accountOnly: true },
]

export function OnlineLayout({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const [theme, setTheme] = useTheme()
  const { user } = useSession()
  const { path } = useRouter()
  const items = user ? NAV.filter((item) => !item.accountOnly || !user.guest) : []
  const nav = user && !bare

  return (
    <div className={`app-shell ${theme} online-shell ${nav ? 'with-tabbar' : ''}`}>
      <header className="topbar online-topbar">
        <Link to="/" className="brand-link" aria-label="Oche home"><Brand /></Link>
        {nav ? (
          <nav className="online-nav" aria-label="Main">
            {items.map((item) => <Link key={item.to} to={item.to} className={`${item.active(path) ? 'active' : ''} ${item.to === '/play' ? 'play-link' : ''}`}>{item.icon} {item.label}</Link>)}
          </nav>
        ) : <span />}
        <div className="header-actions">
          {user && !user.guest && <InvitesButton />}
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
        <span>OCHE</span><i /> <Link to="/about">ABOUT & SCORING</Link><i /> <Link to="/privacy">PRIVACY</Link><i /> <a href="https://github.com/ricsam/dart-scorer" target="_blank" rel="noreferrer">OPEN SOURCE</a>
      </footer>
      {nav && (
        <nav className="tabbar" aria-label="Main (mobile)">
          {items.map((item) => <Link key={item.to} to={item.to} className={`${item.active(path) ? 'active' : ''} ${item.to === '/play' ? 'play-link' : ''}`} aria-current={item.active(path) ? 'page' : undefined}>{item.icon}<span>{item.label}</span></Link>)}
        </nav>
      )}
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
          {user.guest
            ? <button role="menuitem" onClick={() => go(`/login?returnTo=${encodeURIComponent(path)}`)}><LogIn size={15} /> Sign in for an account</button>
            : <>
              <button role="menuitem" onClick={() => go('/me')}><BarChart3 size={15} /> My stats</button>
              <button role="menuitem" onClick={() => go('/me#nickname')}><Pencil size={15} /> Edit dart nickname</button>
              <button role="menuitem" onClick={() => go('/me#picture')}><Pencil size={15} /> Change profile picture</button>
            </>}
          <button role="menuitem" onClick={() => go('/about')}><Info size={15} /> About & scoring</button>
          <button role="menuitem" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />} {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <button role="menuitem" className="danger" onClick={() => { if (user.guest) { setOpen(false); setConfirmSignOut(true) } else { void leaveSession() } }}><LogOut size={15} /> {user.guest ? 'End guest session' : 'Sign out'}</button>
          {error && <p role="alert" className="form-error">{error}</p>}
        </div>
      )}
      {confirmSignOut && <ConfirmDialog icon={<LogOut size={30} />} eyebrow="GUEST SESSION" title="End your guest session?" titleId="guest-signout-title" confirmLabel="END SESSION" onCancel={() => setConfirmSignOut(false)} onConfirm={leaveSession}>
        You cannot recover this guest identity by name after signing out. Your matches will stay in the league’s history.
        {error && <p role="alert">{error}</p>}
      </ConfirmDialog>}
    </div>
  )
}
