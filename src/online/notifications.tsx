import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Bell, X } from 'lucide-react'
import type { LobbyInvite, UserEvent } from '../shared/api'
import { api, errorMessage } from './api'
import { shortFormat } from './format'
import { useEventStreams } from './hooks'
import { useRouter } from './router'
import { useSession } from './session'
import { Avatar } from './ui'

type NotificationsValue = {
  invites: LobbyInvite[]
  accept: (invite: LobbyInvite) => Promise<void>
  decline: (invite: LobbyInvite) => Promise<void>
  error: string | null
}

const NotificationsContext = createContext<NotificationsValue>({ invites: [], accept: async () => {}, decline: async () => {}, error: null })

export const useNotifications = () => useContext(NotificationsContext)

/** Live lobby invitations for signed-in players, on every page (including the scorer). */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useSession()
  const { navigate } = useRouter()
  const enabled = Boolean(user && !user.guest)
  const [invites, setInvites] = useState<LobbyInvite[]>([])
  const [toast, setToast] = useState<LobbyInvite | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!enabled) return
    api.myInvites().then(({ invites: pending }) => setInvites(pending)).catch(() => {})
  }, [enabled])

  useEffect(() => {
    if (!enabled) setInvites([])
  }, [enabled])

  useEventStreams(enabled ? '/api/me/events' : null, {
    user: (event: UserEvent) => {
      if (event.type === 'invite') {
        setInvites((current) => [event.invite, ...current.filter((item) => item.lobby.id !== event.invite.lobby.id)])
        setToast(event.invite)
      } else {
        setInvites((current) => current.filter((item) => item.lobby.id !== event.lobbyId))
        setToast((current) => current?.lobby.id === event.lobbyId ? null : current)
      }
    },
  }, undefined, refresh)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 12000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const accept = useCallback(async (invite: LobbyInvite) => {
    setError(null)
    try {
      await api.joinLobby(invite.lobby.id)
      setInvites((current) => current.filter((item) => item.lobby.id !== invite.lobby.id))
      setToast(null)
      navigate(`/lobbies/${invite.lobby.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
      refresh()
    }
  }, [navigate, refresh])

  const decline = useCallback(async (invite: LobbyInvite) => {
    setInvites((current) => current.filter((item) => item.lobby.id !== invite.lobby.id))
    setToast((current) => current?.lobby.id === invite.lobby.id ? null : current)
    await api.declineInvite(invite.lobby.id).catch(() => refresh())
  }, [refresh])

  return (
    <NotificationsContext.Provider value={{ invites, accept, decline, error }}>
      {children}
      {toast && (
        <div className="invite-toast" role="status">
          <Avatar user={toast.invitedBy} size={30} />
          <span><b>{toast.invitedBy.name}</b> invited you to play<small>{shortFormat(toast.lobby.settings)}{toast.lobby.ranked ? ' · RANKED' : ''}</small></span>
          <button className="primary-button" onClick={() => void accept(toast)}>JOIN</button>
          <button className="invite-toast-close" onClick={() => setToast(null)} aria-label="Dismiss invitation"><X size={14} /></button>
        </div>
      )}
    </NotificationsContext.Provider>
  )
}

/** Header bell listing pending invitations. */
export function InvitesButton() {
  const { invites, accept, decline, error } = useNotifications()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <div className="invites-menu">
      <button className="icon-button invites-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" aria-label={invites.length ? `${invites.length} game invitations` : 'Game invitations'}>
        <Bell size={17} />
        {invites.length > 0 && <span className="chat-badge">{invites.length}</span>}
      </button>
      {open && (
        <div className="invites-panel" role="dialog" aria-label="Game invitations">
          <strong>Invitations</strong>
          {invites.length === 0 ? <p className="muted-note">No invitations right now. Friends can invite you from their lobby.</p> : invites.map((invite) => (
            <div className="invite-row-item" key={invite.lobby.id}>
              <Avatar user={invite.invitedBy} size={26} />
              <span><b>{invite.invitedBy.name}</b><small>{shortFormat(invite.lobby.settings)}{invite.lobby.ranked ? ' · RANKED' : ''} · {invite.lobby.seats.length}/{invite.lobby.capacity}</small></span>
              <button className="primary-button" onClick={() => { setOpen(false); void accept(invite) }}>JOIN</button>
              <button className="ghost-button" onClick={() => void decline(invite)} aria-label={`Decline ${invite.invitedBy.name}'s invitation`}><X size={14} /></button>
            </div>
          ))}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}
