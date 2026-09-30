import { useState, type FormEvent } from 'react'
import { DoorOpen, Users } from 'lucide-react'
import { PLAYER_NAME_MAX_LENGTH } from '../../game'
import { api, errorMessage, googleSignInUrl } from '../api'
import { useDocumentTitle, useResource } from '../hooks'
import { Link, useRouter } from '../router'
import { useSession } from '../session'
import { Avatar, ErrorState, GoogleButton, Loading } from '../ui'

export function JoinPage({ code }: { code: string }) {
  const { user, me, refresh, signOut } = useSession()
  const { navigate } = useRouter()
  const invite = useResource(`invite:${code}:${user?.id ?? 'anon'}`, () => api.invite(code))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [guestId, setGuestId] = useState('')
  useDocumentTitle(invite.data ? `Join ${invite.data.room.name} — Oche` : 'Join room — Oche')

  if (invite.loading) return <Loading />
  if (invite.error) {
    return invite.error.status === 404
      ? <ErrorState message="This invite link is invalid or has been reset. Ask a room member for a new link." />
      : <ErrorState message={invite.error.message} onRetry={invite.reload} />
  }
  if (!invite.data) return null
  const { room, member, guests } = invite.data
  const nameKey = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
  const existing = guests.find((guest) => guest.id === guestId)
    ?? guests.find((guest) => nameKey(guest.name) === nameKey(name))

  const join = async (asGuest = false) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { roomId } = asGuest
        ? await api.joinGuest(code, existing ? { guestId: existing.id } : { name: name.trim() })
        : await api.join(code)
      if (asGuest) await refresh()
      navigate(`/rooms/${roomId}`, { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
      // A slot may have been claimed on another device. Refresh before choosing again.
      setGuestId('')
      void invite.reload()
    }
  }

  const submitGuest = (event: FormEvent) => { event.preventDefault(); void join(true) }

  return (
    <section className="login-page">
      <div className="login-card join-card">
        <DoorOpen size={30} className="join-icon" />
        <span className="eyebrow">ROOM INVITE</span>
        <h1>{room.name}</h1>
        <p className="lead join-meta">
          <Avatar user={room.owner} size={22} /> Hosted by <b>{room.owner.name}</b> · <Users size={14} /> {room.memberCount} {room.memberCount === 1 ? 'player' : 'players'}
        </p>
        {error && <div className="form-error" role="alert">{error}</div>}
        {!user ? (
          <>
            <form className="guest-join" onSubmit={submitGuest}>
              <p className="muted-note">Join without an account. Guests can play and score, but aren’t ranked.</p>
              {guests.length > 0 && (
                <label className="field">
                  <span>Already added by a friend?</span>
                  <select aria-label="Existing guest" value={guestId} onChange={(event) => { setGuestId(event.target.value); setName('') }} disabled={busy}>
                    <option value="">Enter a new name</option>
                    {guests.map((guest) => <option key={guest.id} value={guest.id}>{guest.name}</option>)}
                  </select>
                </label>
              )}
              {!guestId && <label className="field">
                <span>Your name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={PLAYER_NAME_MAX_LENGTH} placeholder="e.g. Alex" autoComplete="nickname" required disabled={busy} />
              </label>}
              {existing && <p className="muted-note">You’ll connect to {existing.name}’s existing guest slot, including any live match. Only choose yourself.</p>}
              <button className="primary-button" disabled={busy || (!existing && !name.trim())}>{busy ? 'JOINING…' : 'JOIN AS A GUEST'}</button>
              <small className="fine-print">Your guest identity stays on this browser. It cannot be recovered by name after signing out or clearing cookies.</small>
            </form>
            {(me?.auth.google || me?.auth.dev) && <>
              <div className="join-divider">OR SIGN IN</div>
              <p className="muted-note">Use an account for a persistent identity, personal stats and rankings.</p>
              {me?.auth.google && <GoogleButton href={googleSignInUrl(`/join/${code}`)} label="Sign in with Google to join" />}
              {me?.auth.dev && <Link className="ghost-button" to={`/login?returnTo=${encodeURIComponent(`/join/${code}`)}`}>SIGN IN TO JOIN</Link>}
            </>}
          </>
        ) : member ? (
          <>
            <p className="muted-note">{user.guest ? `You’ve joined as ${user.name} (guest).` : 'You’re already a member of this room.'}</p>
            <Link className="primary-button" to={`/rooms/${room.id}`}>OPEN ROOM</Link>
          </>
        ) : user.guest ? (
          <>
            <p className="muted-note">You’re using a guest identity from another room or a room you’ve left. End that session before joining here. You won’t be able to recover the old guest identity by name.</p>
            <button className="ghost-button" disabled={busy} onClick={async () => {
              setBusy(true)
              try { await signOut() } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
            }}>END GUEST SESSION</button>
          </>
        ) : (
          <button className="primary-button" onClick={() => { void join() }} disabled={busy}>{busy ? 'JOINING…' : 'JOIN ROOM'}</button>
        )}
      </div>
    </section>
  )
}
