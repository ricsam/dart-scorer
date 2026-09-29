import { useState } from 'react'
import { DoorOpen, Users } from 'lucide-react'
import { api, errorMessage, googleSignInUrl } from '../api'
import { useDocumentTitle, useResource } from '../hooks'
import { Link, useRouter } from '../router'
import { useSession } from '../session'
import { Avatar, ErrorState, GoogleButton, Loading } from '../ui'

export function JoinPage({ code }: { code: string }) {
  const { user, me } = useSession()
  const { navigate } = useRouter()
  const invite = useResource(`invite:${code}:${user?.id ?? 'anon'}`, () => api.invite(code))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useDocumentTitle(invite.data ? `Join ${invite.data.room.name} — Oche` : 'Join room — Oche')

  if (invite.loading) return <Loading />
  if (invite.error) {
    return invite.error.status === 404
      ? <ErrorState message="This invite link is invalid or has been reset. Ask a room member for a new link." />
      : <ErrorState message={invite.error.message} onRetry={invite.reload} />
  }
  if (!invite.data) return null
  const { room, member } = invite.data

  const join = async () => {
    setBusy(true)
    setError(null)
    try {
      const { roomId } = await api.join(code)
      navigate(`/rooms/${roomId}`, { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <section className="login-page">
      <div className="login-card join-card">
        <DoorOpen size={30} className="join-icon" />
        <span className="eyebrow">ROOM INVITE</span>
        <h1>{room.name}</h1>
        <p className="lead join-meta">
          <Avatar user={room.owner} size={22} /> Hosted by <b>{room.owner.name}</b> · <Users size={14} /> {room.memberCount} {room.memberCount === 1 ? 'member' : 'members'}
        </p>
        {error && <div className="form-error" role="alert">{error}</div>}
        {!user ? (
          <>
            <p className="muted-note">Sign in to join the room and play ranked matches with its members.</p>
            {me?.auth.google && <GoogleButton href={googleSignInUrl(`/join/${code}`)} label="Sign in with Google to join" />}
            {me?.auth.dev && <Link className="primary-button" to={`/login?returnTo=${encodeURIComponent(`/join/${code}`)}`}>SIGN IN TO JOIN</Link>}
          </>
        ) : member ? (
          <>
            <p className="muted-note">You’re already a member of this room.</p>
            <Link className="primary-button" to={`/rooms/${room.id}`}>OPEN ROOM</Link>
          </>
        ) : (
          <button className="primary-button" onClick={join} disabled={busy}>{busy ? 'JOINING…' : 'JOIN ROOM'}</button>
        )}
      </div>
    </section>
  )
}
