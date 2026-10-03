import { useEffect } from 'react'
import { StandaloneApp } from '../standalone/StandaloneApp'
import { AboutAction, OnlineInvite, OnlineLayout, RoomsAction, ScoringInfo, SignInAction } from './Layout'
import { matchPath, RouterProvider, useRouter } from './router'
import { SessionProvider, useSession } from './session'
import { safeReturnTo } from './format'
import { ErrorState, Loading } from './ui'
import { AboutPage } from './pages/AboutPage'
import { HomePage } from './pages/HomePage'
import { JoinPage } from './pages/JoinPage'
import { LoginPage } from './pages/LoginPage'
import { MatchPage } from './pages/MatchPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { ProfilePage } from './pages/ProfilePage'
import { RoomPage } from './pages/RoomPage'
import { TrainingPage } from './pages/TrainingPage'
import { TrainingSessionPage } from './pages/TrainingSessionPage'
import './online.css'
import './about.css'

export default function OnlineApp() {
  return (
    <RouterProvider>
      <SessionProvider>
        <Routes />
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

  if (path === '/' || path === '/play') {
    if (!user || path === '/play') {
      return (
        <StandaloneApp
          accountAction={<><AboutAction />{user ? <RoomsAction /> : <SignInAction />}</>}
          accountSettings={<>{!user && <OnlineInvite onSignIn={() => navigate('/login')} />}<ScoringInfo /></>}
        />
      )
    }
    return <OnlineLayout><HomePage /></OnlineLayout>
  }

  if (!user) return <Redirect to={`/login?returnTo=${encodeURIComponent(path + search)}`} />

  if (path === '/training') return <OnlineLayout><TrainingPage /></OnlineLayout>
  const training = matchPath('/training/:sessionId', path)
  if (training) return <OnlineLayout><TrainingSessionPage key={training.sessionId} sessionId={training.sessionId} /></OnlineLayout>

  const room = matchPath('/rooms/:roomId', path)
  if (room) return <OnlineLayout><RoomPage key={room.roomId} roomId={room.roomId} /></OnlineLayout>

  const match = matchPath('/matches/:matchId', path)
  if (match) return <MatchPage key={match.matchId} matchId={match.matchId} />

  if (path === '/me') return user.guest ? <Redirect to="/" /> : <OnlineLayout><ProfilePage /></OnlineLayout>

  return <OnlineLayout><NotFoundPage /></OnlineLayout>
}

function Redirect({ to }: { to: string }) {
  const { navigate } = useRouter()
  useEffect(() => navigate(to, { replace: true }), [navigate, to])
  return null
}
