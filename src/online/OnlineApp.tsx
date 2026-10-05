import { useEffect } from 'react'
import { Globe2, LogIn } from 'lucide-react'
import { StandaloneApp } from '../standalone/StandaloneApp'
import { AboutAction, OnlineInvite, OnlineLayout, ScoringInfo, SignInAction } from './Layout'
import { NotificationsProvider } from './notifications'
import { Link, matchPath, RouterProvider, useRouter } from './router'
import { SessionProvider, useSession } from './session'
import { safeReturnTo } from './format'
import { EmptyState, ErrorState, Loading } from './ui'
import { AboutPage } from './pages/AboutPage'
import { GlobalPage } from './pages/GlobalPage'
import { HomePage } from './pages/HomePage'
import { JoinPage } from './pages/JoinPage'
import { LeaguePage } from './pages/LeaguePage'
import { LeaguesPage } from './pages/LeaguesPage'
import { LobbyPage } from './pages/lobby/LobbyPage'
import { LoginPage } from './pages/LoginPage'
import { MatchPage } from './pages/MatchPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlayPage } from './pages/PlayPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { ProfilePage } from './pages/ProfilePage'
import { TrainingPage } from './pages/TrainingPage'
import { TrainingSessionPage } from './pages/TrainingSessionPage'
import './online.css'
import './about.css'
import './pages/lobby/lobby.css'

export default function OnlineApp() {
  return (
    <RouterProvider>
      <SessionProvider>
        <NotificationsProvider>
          <Routes />
        </NotificationsProvider>
      </SessionProvider>
    </RouterProvider>
  )
}

function Routes() {
  const { path, search, navigate } = useRouter()
  const { user, loading, error, refresh } = useSession()

  if (path === '/about') return <OnlineLayout bare={!user}><AboutPage /></OnlineLayout>
  if (path === '/privacy') return <OnlineLayout bare={!user}><PrivacyPage /></OnlineLayout>
  if (loading) return <OnlineLayout bare><Loading /></OnlineLayout>
  if (error) return <OnlineLayout bare><ErrorState message={error.message} onRetry={refresh} /></OnlineLayout>

  if (path === '/login') {
    if (user && !user.guest) return <Redirect to={safeReturnTo(new URLSearchParams(search).get('returnTo'))} />
    return <OnlineLayout bare><LoginPage /></OnlineLayout>
  }

  const join = matchPath('/join/:code', path)
  if (join) return <OnlineLayout bare={!user}><JoinPage key={join.code} code={join.code} /></OnlineLayout>

  if (path === '/' && !user) {
    // Signed-out visitors can keep score locally without an account.
    return (
      <StandaloneApp
        accountAction={<><AboutAction /><SignInAction /></>}
        accountSettings={<><OnlineInvite onSignIn={() => navigate('/login')} /><ScoringInfo /></>}
      />
    )
  }
  if (path === '/play' && !user) return <Redirect to="/" />

  if (!user) return <Redirect to={`/login?returnTo=${encodeURIComponent(path + search)}`} />

  if (path === '/') return <OnlineLayout><HomePage /></OnlineLayout>

  const lobby = matchPath('/lobbies/:lobbyId', path)
  if (path === '/play' || path === '/global' || lobby) {
    if (user.guest) return <OnlineLayout><AccountOnly /></OnlineLayout>
    if (path === '/play') return <OnlineLayout><PlayPage /></OnlineLayout>
    if (path === '/global') return <OnlineLayout><GlobalPage /></OnlineLayout>
    const code = new URLSearchParams(search).get('code')
    return <OnlineLayout><LobbyPage key={`${lobby!.lobbyId}:${code ?? ''}`} lobbyId={lobby!.lobbyId} code={code} /></OnlineLayout>
  }

  if (path === '/training') return <OnlineLayout><TrainingPage /></OnlineLayout>
  const training = matchPath('/training/:sessionId', path)
  if (training) return <OnlineLayout><TrainingSessionPage key={training.sessionId} sessionId={training.sessionId} /></OnlineLayout>

  if (path === '/leagues') return <OnlineLayout><LeaguesPage /></OnlineLayout>
  const league = matchPath('/leagues/:leagueId', path)
  if (league) return <OnlineLayout><LeaguePage key={league.leagueId} leagueId={league.leagueId} /></OnlineLayout>
  // Leagues were called rooms before; keep old bookmarks and shared links working.
  const legacyRoom = matchPath('/rooms/:leagueId', path)
  if (legacyRoom) return <Redirect to={`/leagues/${encodeURIComponent(legacyRoom.leagueId)}`} />

  const match = matchPath('/matches/:matchId', path)
  if (match) return <MatchPage key={match.matchId} matchId={match.matchId} />

  if (path === '/me') return user.guest ? <Redirect to="/" /> : <OnlineLayout><ProfilePage /></OnlineLayout>

  return <OnlineLayout><NotFoundPage /></OnlineLayout>
}

function AccountOnly() {
  const { path } = useRouter()
  return (
    <EmptyState icon={<Globe2 size={28} />} title="Online play needs an account">
      Lobbies, ranked games and the global stage use your Google account so results and ratings follow you. Guests can keep playing in their league.
      <br /><br /><Link className="primary-button" to={`/login?returnTo=${encodeURIComponent(path)}`}><LogIn size={15} /> SIGN IN WITH AN ACCOUNT</Link>
    </EmptyState>
  )
}

function Redirect({ to }: { to: string }) {
  const { navigate } = useRouter()
  useEffect(() => navigate(to, { replace: true }), [navigate, to])
  return null
}
