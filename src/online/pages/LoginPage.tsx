import { useState, type FormEvent } from 'react'
import { Radio, Trophy, Users } from 'lucide-react'
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
        <p className="lead">Create a league, invite your friends and score matches together. Every leg counts toward your league’s leaderboard.</p>
        {user?.guest && <p className="muted-note">Signing in starts a separate account session. It does not merge your guest slot or rank past guest matches. Join the league with its invite after signing in.</p>}
        {errorCode && <div className="form-error" role="alert">{ERRORS[errorCode] ?? 'Sign-in failed. Please try again.'}</div>}
        {me?.auth.google && <GoogleButton href={googleSignInUrl(returnTo)} />}
        {me && !me.auth.google && !me.auth.dev && <p className="muted-note">Google sign-in is not configured on this server.</p>}
        {me?.auth.dev && <DevLoginForm returnTo={returnTo} />}
        <ul className="login-features">
          <li><Users size={16} /><span><b>Leagues and invites</b>Share a link or QR code to bring players in.</span></li>
          <li><Radio size={16} /><span><b>Live scoring</b>Everyone in the league follows the match from their own phone.</span></li>
          <li><Trophy size={16} /><span><b>Leaderboards</b>League ratings, averages, checkout rates, 180s and best legs.</span></li>
        </ul>
        <Link to="/" className="text-link">Just keeping score? Play without an account →</Link>
        <small className="fine-print">We only use your Google name, email and picture to identify you to your leagues. <Link to="/privacy">Privacy</Link></small>
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
