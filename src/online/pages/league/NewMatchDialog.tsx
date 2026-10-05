import { useState, type FormEvent } from 'react'
import { ArrowUp, Minus, Plus, Shuffle, UserPlus, X } from 'lucide-react'
import { GAMES, MAX_PLAYERS, MIN_PLAYERS, PLAYER_NAME_MAX_LENGTH } from '../../../game/engine'
import type { CreateMatchRequest, MatchSettings, LeagueDetail } from '../../../shared/api'
import { BOT_ROSTER, type BotProfile } from '../../../shared/bots'
import { BotAvatar, BotBadge } from '../../BotAvatar'
import { api, errorMessage } from '../../api'
import { useRouter } from '../../router'
import { useSession } from '../../session'
import { Avatar, Segmented, Sheet } from '../../ui'
import '../../stats-progress.css'

type Slot = { botId: string | null; key: string; userId: string | null; guestId: string | null; name: string; avatarUrl: string | null }
const memberSlot = (member: LeagueDetail['members'][number]): Slot => ({
  botId: null, key: member.id, userId: member.guest ? null : member.id, guestId: member.guest ? member.id : null, name: member.name, avatarUrl: member.avatarUrl,
})

const MAX_LEGS = 11

export function NewMatchDialog({ league, onClose, botsInitiallyOpen = false, requireBot = false }: { league: LeagueDetail; onClose: () => void; botsInitiallyOpen?: boolean; requireBot?: boolean }) {
  const { user } = useSession()
  const { navigate } = useRouter()
  const me = league.members.find((member) => member.id === user?.id)
  const [slots, setSlots] = useState<Slot[]>(() => me ? [memberSlot(me)] : [])
  const [addedGuests, setAddedGuests] = useState<LeagueDetail['members']>([])
  const [adding, setAdding] = useState(false)
  const members = [...league.members, ...addedGuests.filter((guest) => !league.members.some((member) => member.id === guest.id))]
  const [guestName, setGuestName] = useState('')
  const [settings, setSettings] = useState<MatchSettings>(league.defaults)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [botsOpen, setBotsOpen] = useState(botsInitiallyOpen)

  const hasHuman = slots.some((slot) => !slot.botId)
  const needsBot = requireBot && !slots.some((slot) => slot.botId)
  const full = slots.length >= MAX_PLAYERS
  const toggleBot = (bot: BotProfile) => setSlots((current) => current.some((slot) => slot.botId === bot.id)
    ? current.filter((slot) => slot.botId !== bot.id)
    : current.length >= MAX_PLAYERS ? current : [...current, { key: `bot-${bot.id}`, botId: bot.id, userId: null, guestId: null, name: bot.name, avatarUrl: null }])
  const toggleMember = (member: LeagueDetail['members'][number]) => {
    setSlots((current) => current.some((slot) => slot.key === member.id)
      ? current.filter((slot) => slot.key !== member.id)
      : current.length >= MAX_PLAYERS ? current : [...current, memberSlot(member)])
  }

  const addGuest = async () => {
    const name = guestName.trim().slice(0, PLAYER_NAME_MAX_LENGTH)
    if (!name || full || adding) return
    setAdding(true)
    setError(null)
    try {
      const { guest } = await api.addGuest(league.id, name)
      setAddedGuests((current) => [...current.filter((item) => item.id !== guest.id), guest])
      setSlots((current) => current.some((slot) => slot.key === guest.id) || current.length >= MAX_PLAYERS ? current : [...current, memberSlot(guest)])
      setGuestName('')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setAdding(false)
    }
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
    if (slots.length < MIN_PLAYERS || slots.length > MAX_PLAYERS || !hasHuman || needsBot || busy) return
    setBusy(true)
    setError(null)
    const body: CreateMatchRequest = {
      players: slots.map((slot) => slot.botId ? { botId: slot.botId } : slot.guestId ? { guestId: slot.guestId } : { userId: slot.userId! }),
      settings,
    }
    try {
      const { match } = await api.createMatch(league.id, body)
      navigate(`/matches/${match.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <Sheet title={requireBot ? 'Bot practice' : 'New match'} eyebrow={league.name.toUpperCase()} onClose={onClose} labelledBy="new-match-title" wide>
      <form className="sheet-form new-match" onSubmit={submit}>
        <div className="settings-section">
          <div className="roster-heading">
            <div className="settings-copy">
              <strong>Players & throw order</strong>
              <span>Tap league players to add them. The first player throws first; the starter rotates each leg.</span>
            </div>
            <span className="player-count">{slots.length}/{MAX_PLAYERS}</span>
          </div>

          <div className="member-picker">
            {members.map((member) => {
              const order = slots.findIndex((slot) => slot.key === member.id)
              return (
                <button type="button" key={member.id} className={order >= 0 ? 'picked' : ''} onClick={() => toggleMember(member)} disabled={order < 0 && full} aria-pressed={order >= 0}>
                  <Avatar user={member} size={24} />
                  <span>{member.name}</span>
                  {member.guest && <small>GUEST</small>}
                  {order >= 0 && <b>{order + 1}</b>}
                </button>
              )
            })}
          </div>

          <div className="guest-add">
            <input value={guestName} maxLength={PLAYER_NAME_MAX_LENGTH} onChange={(event) => setGuestName(event.target.value)} placeholder="Guest name (not ranked)" aria-label="Guest name"
              disabled={busy || adding} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addGuest() } }} />
            <button type="button" className="ghost-button" onClick={addGuest} disabled={!guestName.trim() || full || busy || adding}><UserPlus size={15} /> {adding ? 'ADDING…' : 'ADD GUEST'}</button>
          </div>

          <p className="field-hint">Guests stay in the league roster even if you cancel this match. They can connect to their slot from the invite link and are never ranked.</p>

          <details className="bot-picker-disclosure" open={botsOpen} onToggle={(event) => setBotsOpen(event.currentTarget.open)}>
          <summary>Practice against bots <span>{slots.filter((slot) => slot.botId).length} selected · {BOT_ROSTER.length} available</span></summary>
          <div className="bot-roster-heading"><strong>Meet your practice rivals</strong><span>Six original characters. Six levels. Your next challenge.</span></div>
          <div className="bot-roster" role="group" aria-label="Automatic bot opponents">
            {BOT_ROSTER.map((bot) => {
              const picked = slots.some((slot) => slot.botId === bot.id)
              return <button key={bot.id} type="button" className={`bot-card ${picked ? 'picked' : ''}`} aria-pressed={picked} aria-label={`${picked ? 'Remove' : 'Add'} ${bot.name}, level ${bot.difficulty}, ${bot.level}`} disabled={busy || (!picked && full)} onClick={() => toggleBot(bot)}>
                <BotAvatar botId={bot.id} size={48} />
                <span className="bot-card-copy"><small>LEVEL {bot.difficulty} · {bot.level}</small><strong>{bot.name}</strong><em>“{bot.nickname}”</em></span>
                <span className="bot-toggle" aria-hidden="true">{picked ? <Minus size={16} /> : <Plus size={16} />}</span>
                <span className="bot-description">{bot.description}</span>
                <span className="bot-skill"><span aria-hidden="true">{[1, 2, 3, 4, 5, 6].map((level) => <i key={level} className={level <= bot.difficulty ? 'filled' : ''} />)}</span><span>{bot.average} AVG</span></span>
              </button>
            })}
          </div>
          <p className="field-hint bot-roster-note">Bots throw automatically, one dart at a time. Include at least one human (a league player or guest). Averages are approximate for 501, single in / double out. All characters are fictional.</p>
          </details>
          <p className="field-hint">All bot games are training-only for everyone: no impact on competition wins, losses or ratings. Statistics are saved separately under Training.</p>

          {slots.length > 0 && (
            <ol className="throw-order">
              {slots.map((slot, index) => (
                <li key={slot.key}>
                  <span className="order-number">{index + 1}</span>
                  {slot.botId ? <BotAvatar botId={slot.botId} size={22} /> : <Avatar user={{ id: slot.userId ?? slot.key, name: slot.name, avatarUrl: slot.avatarUrl }} size={22} />}
                  <b>{slot.name}</b>
                  {slot.botId ? <BotBadge botId={slot.botId} /> : !slot.userId && <small>GUEST</small>}
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
          <span className="sheet-summary">{!hasHuman ? 'Include at least one human' : needsBot ? 'Choose at least one bot for training' : slots.length < MIN_PLAYERS ? `Pick at least ${MIN_PLAYERS} players` : `${slots.length} players · ${settings.game} · first to ${settings.legsToWin}`}</span>
          <button type="button" className="ghost-button" onClick={onClose}>CANCEL</button>
          <button className="primary-button" disabled={busy || adding || !hasHuman || needsBot || slots.length < MIN_PLAYERS || slots.length > MAX_PLAYERS}>{busy ? 'STARTING…' : 'START MATCH'}</button>
        </div>
      </form>
    </Sheet>
  )
}
