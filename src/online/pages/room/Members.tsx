import { useState, type FormEvent } from 'react'
import { Crown, LogOut, Pencil, Share2, Trash2, UserMinus } from 'lucide-react'
import type { RoomDetail, RoomMember } from '../../../shared/api'
import { api, errorMessage } from '../../api'
import { formatDate, formatRating } from '../../format'
import { useRouter } from '../../router'
import { useSession } from '../../session'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { Avatar, Sheet } from '../../ui'

type Pending =
  | { kind: 'remove'; member: RoomMember }
  | { kind: 'leave' }
  | { kind: 'delete' }

export function Members({ room, onChanged, onInvite, onRename }: { room: RoomDetail; onChanged: () => void; onInvite: () => void; onRename: () => void }) {
  const { user } = useSession()
  const { navigate } = useRouter()
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isOwner = room.role === 'owner'

  const run = async () => {
    if (!pending || !user) return
    setBusy(true)
    setError(null)
    try {
      if (pending.kind === 'remove') {
        await api.removeMember(room.id, pending.member.id)
        setPending(null)
        onChanged()
      } else if (pending.kind === 'leave') {
        await api.removeMember(room.id, user.id)
        navigate('/', { replace: true })
      } else {
        await api.deleteRoom(room.id)
        navigate('/', { replace: true })
      }
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-label="Members">
      <div className="member-list">
        {room.members.map((member) => (
          <div className="member-row" key={member.id}>
            <Avatar user={member} size={34} />
            <span className="member-name">
              <b>{member.name}{member.id === user?.id && <em> (you)</em>}</b>
              <small>Joined {formatDate(member.joinedAt)} · {member.matches} {member.matches === 1 ? 'match' : 'matches'}</small>
            </span>
            {member.role === 'owner' && <span className="role-pill"><Crown size={11} /> HOST</span>}
            <span className="member-rating"><small>RATING</small><b>{formatRating(member.rating)}</b></span>
            {isOwner && member.id !== user?.id ? (
              <button className="icon-button" onClick={() => setPending({ kind: 'remove', member })} aria-label={`Remove ${member.name} from the room`}><UserMinus size={16} /></button>
            ) : <span className="member-action-spacer" />}
          </div>
        ))}
      </div>
      <button className="add-player invite-row" onClick={onInvite}><Share2 size={16} /> INVITE PLAYERS</button>

      <div className="danger-zone">
        {isOwner ? (
          <>
            <button className="ghost-button" onClick={onRename}><Pencil size={15} /> RENAME ROOM</button>
            <button className="ghost-button danger" onClick={() => setPending({ kind: 'delete' })}><Trash2 size={15} /> DELETE ROOM</button>
          </>
        ) : (
          <button className="ghost-button danger" onClick={() => setPending({ kind: 'leave' })}><LogOut size={15} /> LEAVE ROOM</button>
        )}
      </div>
      {error && !pending && <div className="form-error" role="alert">{error}</div>}

      {pending && (
        <ConfirmDialog
          icon={pending.kind === 'delete' ? <Trash2 size={30} /> : <UserMinus size={30} />}
          eyebrow={pending.kind === 'delete' ? 'DELETE ROOM' : pending.kind === 'leave' ? 'LEAVE ROOM' : 'REMOVE MEMBER'}
          title={pending.kind === 'delete' ? `Delete ${room.name}?` : pending.kind === 'leave' ? `Leave ${room.name}?` : `Remove ${pending.member.name}?`}
          titleId="member-confirm-title"
          confirmLabel={busy ? 'WORKING…' : pending.kind === 'delete' ? 'DELETE ROOM' : pending.kind === 'leave' ? 'LEAVE' : 'REMOVE'}
          onCancel={() => { setPending(null); setError(null) }}
          onConfirm={run}
          busy={busy}
        >
          {pending.kind === 'delete'
            ? 'Every match, result and rating in this room will be permanently deleted for all members.'
            : pending.kind === 'leave'
              ? 'You will lose access to the room and its leaderboard. Your past matches stay in its history. You can rejoin with an invite link.'
              : 'They will lose access to the room. Their past matches stay in the history, and they can rejoin with an invite link unless you reset it.'}
          {error && <><br /><b className="confirm-error">{error}</b></>}
        </ConfirmDialog>
      )}
    </section>
  )
}

export function RenameRoomDialog({ room, onClose, onRenamed }: { room: RoomDetail; onClose: () => void; onRenamed: (room: RoomDetail) => void }) {
  const [name, setName] = useState(room.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { room: updated } = await api.renameRoom(room.id, name.trim())
      onRenamed(updated)
      onClose()
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <Sheet title="Rename room" eyebrow="ROOM SETTINGS" onClose={onClose} labelledBy="rename-room-title">
      <form className="sheet-form" onSubmit={submit}>
        <label className="field">
          <span>Room name</span>
          <input autoFocus value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="sheet-actions">
          <button type="button" className="ghost-button" onClick={onClose}>CANCEL</button>
          <button className="primary-button" disabled={busy || !name.trim() || name.trim() === room.name}>SAVE</button>
        </div>
      </form>
    </Sheet>
  )
}
