import { useState, type FormEvent } from 'react'
import { ArrowUp, Minus, Plus, Shuffle, UserPlus, X } from 'lucide-react'
import { GAMES, MAX_PLAYERS, MIN_PLAYERS, PLAYER_NAME_MAX_LENGTH } from '../../../game/engine'
import type { CreateMatchRequest, MatchSettings, RoomDetail } from '../../../shared/api'
import { api, errorMessage } from '../../api'
import { useRouter } from '../../router'
import { useSession } from '../../session'
import { Avatar, Segmented, Sheet } from '../../ui'

type Slot = { key: string; userId: string | null; name: string; avatarUrl: string | null }

const MAX_LEGS = 11

export function NewMatchDialog({ room, onClose }: { room: RoomDetail; onClose: () => void }) {
  const { user } = useSession()
  const { navigate } = useRouter()
  const me = room.members.find((member) => member.id === user?.id)
  const [slots, setSlots] = useState<Slot[]>(() => me ? [{ key: me.id, userId: me.id, name: me.name, avatarUrl: me.avatarUrl }] : [])
  const [guestName, setGuestName] = useState('')
  const [settings, setSettings] = useState<MatchSettings>(room.defaults)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const full = slots.length >= MAX_PLAYERS
  const toggleMember = (member: RoomDetail['members'][number]) => {
    setSlots((current) => current.some((slot) => slot.userId === member.id)
      ? current.filter((slot) => slot.userId !== member.id)
      : current.length >= MAX_PLAYERS ? current : [...current, { key: member.id, userId: member.id, name: member.name, avatarUrl: member.avatarUrl }])
  }

  const addGuest = () => {
    const name = guestName.trim().slice(0, PLAYER_NAME_MAX_LENGTH)
    if (!name || full) return
    setSlots((current) => [...current, { key: `guest-${Date.now()}`, userId: null, name, avatarUrl: null }])
    setGuestName('')
  }

  const moveUp = (index: number) => setSlots((current) => {
    if (index === 0) return current
    const next = [...current]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    return next
  })

  const shuffle = () => setSlots((current) => {
    const next = [...current]
    for (let index = next.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1))
      ;[next[index], next[swap]] = [next[swap], next[index]]
    }
    return next
  })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (slots.length < MIN_PLAYERS) return
    setBusy(true)
    setError(null)
    const body: CreateMatchRequest = {
      players: slots.map((slot) => slot.userId ? { userId: slot.userId } : { guestName: slot.name }),
      settings,
    }
    try {
      const { match } = await api.createMatch(room.id, body)
      navigate(`/matches/${match.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <Sheet title="New match" eyebrow={room.name.toUpperCase()} onClose={onClose} labelledBy="new-match-title" wide>
      <form className="sheet-form new-match" onSubmit={submit}>
        <div className="settings-section">
          <div className="roster-heading">
            <div className="settings-copy">
              <strong>Players & throw order</strong>
              <span>Tap members to add them. The first player throws first; the starter rotates each leg.</span>
            </div>
            <span className="player-count">{slots.length}/{MAX_PLAYERS}</span>
          </div>

          <div className="member-picker">
            {room.members.map((member) => {
              const order = slots.findIndex((slot) => slot.userId === member.id)
              return (
                <button type="button" key={member.id} className={order >= 0 ? 'picked' : ''} onClick={() => toggleMember(member)} disabled={order < 0 && full} aria-pressed={order >= 0}>
                  <Avatar user={member} size={24} />
                  <span>{member.name}</span>
                  {order >= 0 && <b>{order + 1}</b>}
                </button>
              )
            })}
          </div>

          <div className="guest-add">
            <input value={guestName} maxLength={PLAYER_NAME_MAX_LENGTH} onChange={(event) => setGuestName(event.target.value)} placeholder="Guest name (not ranked)" aria-label="Guest name"
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addGuest() } }} />
            <button type="button" className="ghost-button" onClick={addGuest} disabled={!guestName.trim() || full}><UserPlus size={15} /> ADD GUEST</button>
          </div>

          {slots.length > 0 && (
            <ol className="throw-order">
              {slots.map((slot, index) => (
                <li key={slot.key}>
                  <span className="order-number">{index + 1}</span>
                  <Avatar user={{ id: slot.userId ?? slot.key, name: slot.name, avatarUrl: slot.avatarUrl }} size={22} />
                  <b>{slot.name}</b>
                  {!slot.userId && <small>GUEST</small>}
                  <button type="button" onClick={() => moveUp(index)} disabled={index === 0} aria-label={`Move ${slot.name} earlier`}><ArrowUp size={14} /></button>
                  <button type="button" onClick={() => setSlots((current) => current.filter((item) => item.key !== slot.key))} aria-label={`Remove ${slot.name}`}><X size={14} /></button>
                </li>
              ))}
            </ol>
          )}
          {slots.length > 1 && <button type="button" className="text-button" onClick={shuffle}><Shuffle size={13} /> SHUFFLE ORDER</button>}
        </div>

        <div className="settings-section rule-settings">
          <div className="rule-row">
            <div><strong>Game</strong><span>Starting score for every leg.</span></div>
            <Segmented label="Game" value={settings.game} options={GAMES.map((game) => ({ value: game, label: game }))} onChange={(game) => setSettings((current) => ({ ...current, game }))} />
          </div>
          <div className="rule-row">
            <div><strong>Starting rule</strong><span>{settings.doubleIn ? 'Scoring begins only after hitting a double.' : 'Every scoring dart counts immediately.'}</span></div>
            <Segmented label="Starting rule" value={settings.doubleIn ? 'double' : 'single'} options={[{ value: 'single', label: 'SINGLE IN' }, { value: 'double', label: 'DOUBLE IN' }]} onChange={(value) => setSettings((current) => ({ ...current, doubleIn: value === 'double' }))} />
          </div>
          <div className="rule-row">
            <div><strong>Checkout rule</strong><span>{settings.doubleOut ? 'The final dart must be a double or inner bull.' : 'Any dart that reaches exactly zero wins.'}</span></div>
            <Segmented label="Checkout rule" value={settings.doubleOut ? 'double' : 'single'} options={[{ value: 'single', label: 'SINGLE OUT' }, { value: 'double', label: 'DOUBLE OUT' }]} onChange={(value) => setSettings((current) => ({ ...current, doubleOut: value === 'double' }))} />
          </div>
          <div className="rule-row">
            <div><strong>Match length</strong><span>First player to win {settings.legsToWin} {settings.legsToWin === 1 ? 'leg' : 'legs'} wins the match.</span></div>
            <div className="stepper" role="group" aria-label="Legs to win">
              <button type="button" onClick={() => setSettings((current) => ({ ...current, legsToWin: Math.max(1, current.legsToWin - 1) }))} disabled={settings.legsToWin <= 1} aria-label="Fewer legs"><Minus size={14} /></button>
              <span><small>FIRST TO</small><b>{settings.legsToWin}</b></span>
              <button type="button" onClick={() => setSettings((current) => ({ ...current, legsToWin: Math.min(MAX_LEGS, current.legsToWin + 1) }))} disabled={settings.legsToWin >= MAX_LEGS} aria-label="More legs"><Plus size={14} /></button>
            </div>
          </div>
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="sheet-actions">
          <span className="sheet-summary">{slots.length < MIN_PLAYERS ? `Pick at least ${MIN_PLAYERS} players` : `${slots.length} players · ${settings.game} · first to ${settings.legsToWin}`}</span>
          <button type="button" className="ghost-button" onClick={onClose}>CANCEL</button>
          <button className="primary-button" disabled={busy || slots.length < MIN_PLAYERS}>{busy ? 'STARTING…' : 'START MATCH'}</button>
        </div>
      </form>
    </Sheet>
  )
}
