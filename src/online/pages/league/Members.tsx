import { useState, type FormEvent } from 'react'
import { Crown, LogOut, Pencil, Share2, Trash2, UserMinus, UserPlus } from 'lucide-react'
import type { LeagueDetail, LeagueMember, UpdateMemberRoleRequest } from '../../../shared/api'
import { PLAYER_NAME_MAX_LENGTH } from '../../../game'
import { api, errorMessage } from '../../api'
import { formatDate, formatRating } from '../../format'
import { useRouter } from '../../router'
import { useSession } from '../../session'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { Avatar, Sheet } from '../../ui'

type Pending =
  | { kind: 'remove'; member: LeagueMember }
  | { kind: 'role'; member: LeagueMember; role: UpdateMemberRoleRequest['role'] }
  | { kind: 'leave' }
  | { kind: 'delete' }

export function Members({ league, onChanged, onInvite, onRename }: { league: LeagueDetail; onChanged: () => void; onInvite: () => void; onRename: () => void }) {
  const { user, signOut } = useSession()
  const { navigate } = useRouter()
  const [guestName, setGuestName] = useState('')
  const [adding, setAdding] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isOwner = league.role === 'owner'
  const isHost = isOwner || league.role === 'cohost'

  const run = async () => {
    if (!pending || !user || busy) return
    setBusy(true)
    setError(null)
    try {
      if (pending.kind === 'role') {
        await api.updateMemberRole(league.id, pending.member.id, pending.role)
        setPending(null)
        onChanged()
      } else if (pending.kind === 'remove') {
        await api.removeMember(league.id, pending.member.id)
        setPending(null)
        onChanged()
      } else if (pending.kind === 'leave') {
        await api.removeMember(league.id, user.id)
        if (user.guest) await signOut()
        navigate('/leagues', { replace: true })
      } else {
        await api.deleteLeague(league.id)
        navigate('/leagues', { replace: true })
      }
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const addGuest = async (event: FormEvent) => {
    event.preventDefault()
    if (adding || !guestName.trim()) return
    setAdding(true)
    setError(null)
    try {
      await api.addGuest(league.id, guestName.trim())
      setGuestName('')
      onChanged()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setAdding(false)
    }
  }

  return (
    <section className="panel" aria-label="Members">
      <div className="member-list">
        {league.members.map((member) => (
          <div className="member-row" key={member.id}>
            <Avatar user={member} size={34} />
            <span className="member-name">
              <b>{member.name}{member.id === user?.id && <em> (you)</em>}</b>
              {member.role !== 'member' && <span className="role-pill"><Crown size={11} /> {member.role === 'owner' ? 'HOST' : 'CO-HOST'}</span>}
              <small>{member.guest ? (member.claimed ? 'Connected to a device · unranked' : 'Shared-device player · can connect via invite') : `Joined ${formatDate(member.joinedAt)} · ${member.matches} ${member.matches === 1 ? 'match' : 'matches'}`}</small>
            </span>
            {member.guest ? <span className="role-pill">GUEST</span> : <span className="member-rating"><small>RATING</small><b>{formatRating(member.rating)}</b></span>}
            <div className="member-actions">
              {isHost && !member.guest && member.role === 'member' && (
                <button className="ghost-button" disabled={busy} onClick={() => { setError(null); setPending({ kind: 'role', member, role: 'cohost' }) }} aria-label={`Make ${member.name} a co-host`}><Crown size={14} /> MAKE CO-HOST</button>
              )}
              {isOwner && member.role === 'cohost' && (
                <button className="ghost-button" disabled={busy} onClick={() => { setError(null); setPending({ kind: 'role', member, role: 'member' }) }} aria-label={`Remove co-host role from ${member.name}`}>REMOVE CO-HOST</button>
              )}
              {isHost && member.role !== 'owner' && member.id !== user?.id && (isOwner || member.role === 'member') && (
                <button className="icon-button" disabled={busy} onClick={() => { setError(null); setPending({ kind: 'remove', member }) }} aria-label={`Remove ${member.name} from the league`}><UserMinus size={16} /></button>
              )}
            </div>
          </div>
        ))}
      </div>
      <form className="guest-add" onSubmit={addGuest}>
        <input aria-label="Guest name" placeholder="Guest name (not ranked)" maxLength={PLAYER_NAME_MAX_LENGTH} value={guestName} onChange={(event) => setGuestName(event.target.value)} disabled={adding} required />
        <button className="ghost-button" disabled={adding || !guestName.trim()}><UserPlus size={15} /> {adding ? 'ADDING…' : 'ADD GUEST'}</button>
      </form>
      <p className="field-hint">Add someone playing on a shared device, or invite them to join as a guest from their own phone.</p>
      <button className="add-player invite-row" onClick={onInvite}><Share2 size={16} /> INVITE PLAYERS</button>

      {isHost && <p className="field-hint">Co-hosts can manage members, invites and matches, and appoint more co-hosts. Only the original host can revoke co-host access or delete the league. Guests cannot be co-hosts.</p>}
      <div className="danger-zone">
        {isHost && <button className="ghost-button" onClick={onRename}><Pencil size={15} /> RENAME LEAGUE</button>}
        {isOwner ? (
          <button className="ghost-button danger" onClick={() => setPending({ kind: 'delete' })}><Trash2 size={15} /> DELETE LEAGUE</button>
        ) : (
          <button className="ghost-button danger" onClick={() => setPending({ kind: 'leave' })}><LogOut size={15} /> LEAVE LEAGUE</button>
        )}
      </div>
      {error && !pending && <div className="form-error" role="alert">{error}</div>}

      {pending?.kind === 'role' && (
        <Sheet title={pending.role === 'cohost' ? `Make ${pending.member.name} a co-host?` : `Remove ${pending.member.name} as co-host?`} eyebrow="LEAGUE HOSTS" labelledBy="member-role-title" onClose={() => { if (!busy) { setPending(null); setError(null) } }}>
          <div className="sheet-form">
            <p className="field-hint">{pending.role === 'cohost'
              ? 'They’ll be able to rename the league, manage members and invites, score and delete matches, and appoint other co-hosts. Only the original host can revoke co-host access or delete the league.'
              : 'They’ll stay in the league as a member, but lose their co-host permissions. Their matches and ratings will not change.'}</p>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="sheet-actions">
              <button className="ghost-button" disabled={busy} onClick={() => { setPending(null); setError(null) }}>CANCEL</button>
              <button className="primary-button" disabled={busy} onClick={run}>{busy ? 'SAVING…' : pending.role === 'cohost' ? 'MAKE CO-HOST' : 'REMOVE CO-HOST'}</button>
            </div>
          </div>
        </Sheet>
      )}
      {pending && pending.kind !== 'role' && (
        <ConfirmDialog
          icon={pending.kind === 'delete' ? <Trash2 size={30} /> : <UserMinus size={30} />}
          eyebrow={pending.kind === 'delete' ? 'DELETE LEAGUE' : pending.kind === 'leave' ? 'LEAVE LEAGUE' : 'REMOVE MEMBER'}
          title={pending.kind === 'delete' ? `Delete ${league.name}?` : pending.kind === 'leave' ? `Leave ${league.name}?` : `Remove ${pending.member.name}?`}
          titleId="member-confirm-title"
          confirmLabel={busy ? 'WORKING…' : pending.kind === 'delete' ? 'DELETE LEAGUE' : pending.kind === 'leave' ? 'LEAVE' : 'REMOVE'}
          onCancel={() => { setPending(null); setError(null) }}
          onConfirm={run}
          busy={busy}
        >
          {pending.kind === 'delete'
            ? 'Every match, result and rating in this league will be permanently deleted for all members.'
            : pending.kind === 'leave'
              ? user?.guest
                ? 'You will lose access and end this guest session. Your past matches stay in the history. You can join again as a new guest, but cannot recover this identity by name.'
                : 'You will lose access to the league and its leaderboard. Your past matches stay in its history. You can rejoin with an invite link.'
              : 'They will lose access to the league. Their past matches stay in the history, and they can rejoin with an invite link unless you reset it.'}
          {error && <><br /><b className="confirm-error">{error}</b></>}
        </ConfirmDialog>
      )}
    </section>
  )
}

export function RenameLeagueDialog({ league, onClose, onRenamed }: { league: LeagueDetail; onClose: () => void; onRenamed: (league: LeagueDetail) => void }) {
  const [name, setName] = useState(league.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { league: updated } = await api.renameLeague(league.id, name.trim())
      onRenamed(updated)
      onClose()
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <Sheet title="Rename league" eyebrow="LEAGUE SETTINGS" onClose={onClose} labelledBy="rename-league-title">
      <form className="sheet-form" onSubmit={submit}>
        <label className="field">
          <span>League name</span>
          <input autoFocus value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="sheet-actions">
          <button type="button" className="ghost-button" onClick={onClose}>CANCEL</button>
          <button className="primary-button" disabled={busy || !name.trim() || name.trim() === league.name}>SAVE</button>
        </div>
      </form>
    </Sheet>
  )
}
