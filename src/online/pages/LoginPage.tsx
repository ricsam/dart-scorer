import { useState, type FormEvent } from 'react'
import { Globe2, LineChart, Trophy, Users } from 'lucide-react'
import { api, errorMessage, googleSignInUrl } from '../api'
import { safeReturnTo } from '../format'
import { useDocumentTitle } from '../hooks'
import { Link, useRouter } from '../router'
import { useSession } from '../session'
import { GoogleButton } from '../ui'

const ERRORS: Record<string, string> = {
  access_denied: 'Sign-in was cancelled.',
  state_mismatch: 'Your sign-in session expired. Please try again.',
  google_failed: 'Google sign-in failed. Please try again.',
}

export function LoginPage() {
  useDocumentTitle('Sign in — Oche')
  const { me, user } = useSession()
  const { search } = useRouter()
  const params = new URLSearchParams(search)
  const returnTo = safeReturnTo(params.get('returnTo'))
  const errorCode = params.get('error')

  return (
    <section className="login-page">
      <div className="login-card">
        <span className="login-mark brand-mark" aria-hidden="true"><i /><i /><i /></span>
        <span className="eyebrow">OCHE ONLINE</span>
        <h1>Your darts crew, one oche.</h1>
        <p className="lead">Practise solo and watch your average climb, settle it with friends in a league, or take on anyone in ranked games.</p>
        {user?.guest && <p className="muted-note">Signing in starts a separate account session. It does not merge your guest slot or rank past guest matches. Join the league with its invite after signing in.</p>}
        {errorCode && <div className="form-error" role="alert">{ERRORS[errorCode] ?? 'Sign-in failed. Please try again.'}</div>}
        {me?.auth.google && <GoogleButton href={googleSignInUrl(returnTo)} />}
        {me && !me.auth.google && !me.auth.dev && <p className="muted-note">Google sign-in is not configured on this server.</p>}
        {me?.auth.dev && <DevLoginForm returnTo={returnTo} />}
        <ul className="login-features">
          <li><LineChart size={16} /><span><b>Track your game</b>Solo practice and bot games build your 3-dart average, checkout rate and personal bests over time.</span></li>
          <li><Users size={16} /><span><b>Play with friends</b>Lobbies with chat and invites, or a league with its own leaderboard. Everyone scores on their own phone.</span></li>
          <li><Globe2 size={16} /><span><b>The global stage</b>Join public lobbies and climb the ranked table.</span></li>
          <li><Trophy size={16} /><span><b>Every stat</b>Ratings, averages, first nine, checkouts, 180s and best legs.</span></li>
        </ul>
        <Link to="/" className="text-link">Just keeping score? Play without an account →</Link>
        <small className="fine-print">We only use your Google name, email and picture to identify you to other players. <Link to="/privacy">Privacy</Link></small>
      </div>
    </section>
  )
}

function DevLoginForm({ returnTo }: { returnTo: string }) {
  const { refresh } = useSession()
  const { navigate } = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.devLogin({ name: name.trim(), email: email.trim() })
      await refresh()
      navigate(returnTo, { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="dev-login" onSubmit={submit}>
      <span className="eyebrow">DEVELOPMENT SIGN-IN</span>
      <input aria-label="Name" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} maxLength={24} required />
      <input aria-label="Email" placeholder="email@example.com" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="primary-button" disabled={busy}>SIGN IN (DEV)</button>
    </form>
  )
}
