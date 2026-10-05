import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUp, Bot, Crown, DoorOpen, Globe2, Lock, Minus, Play, Plus, Radio, Shuffle, Trophy, UserPlus, Users, X } from 'lucide-react'
import { PLAYER_NAME_MAX_LENGTH } from '../../../game/engine'
import type { ChatEvent, LobbyDetail, LobbyEvent, LobbyOptionsRequest, LobbySeat } from '../../../shared/api'
import { getBot } from '../../../shared/bots'
import { BotAvatar } from '../../BotAvatar'
import { api, ApiRequestError, errorMessage } from '../../api'
import { ChatPanel, useChat } from '../../chat'
import { formatAverage, shortFormat } from '../../format'
import { useDocumentTitle, useEventStreams } from '../../hooks'
import { Link, useRouter } from '../../router'
import { useSession } from '../../session'
import { Avatar, ErrorState, Loading, Segmented, Sheet } from '../../ui'
import { BotRoster } from '../components/BotRoster'
import { MatchSettingsFields } from '../components/MatchSettingsFields'
import { MatchRow } from '../components/MatchRow'
import { InviteSheet } from './InviteSheet'
import './lobby.css'

const MAX_SEATS = 8

export function LobbyPage({ lobbyId, code }: { lobbyId: string; code: string | null }) {
  const { user } = useSession()
  const { navigate, search } = useRouter()
  const [lobby, setLobby] = useState<LobbyDetail | null>(null)
  const [loadError, setLoadError] = useState<ApiRequestError | null>(null)
  const [ended, setEnded] = useState<'removed' | 'closed' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'invite' | 'bots' | null>(null)
  const followed = useRef<string | null>(null)
  const member = lobby !== null && lobby.role !== 'visitor'
  useDocumentTitle(lobby ? `${lobby.role === 'leader' ? 'Your lobby' : `${lobby.leader.name}’s lobby`} — Oche` : 'Lobby — Oche')

  const load = useCallback(async () => {
    try {
      const { lobby: loaded } = await api.lobby(lobbyId, code)
      setLobby(loaded)
      setLoadError(null)
    } catch (caught) {
      setLoadError(caught instanceof ApiRequestError ? caught : new ApiRequestError(0, null))
    }
  }, [lobbyId, code])

  useEffect(() => { void load() }, [load])

  const follow = useCallback((matchId: string) => {
    if (followed.current === matchId) return
    followed.current = matchId
    navigate(`/matches/${matchId}`)
  }, [navigate])

  const chat = useChat(member && !ended ? `lobby:${lobbyId}` : null, () => api.lobbyChat(lobbyId), (body) => api.postLobbyChat(lobbyId, body), true)
  const stream = useEventStreams(member && !ended ? `/api/lobbies/${encodeURIComponent(lobbyId)}/events` : null, {
    lobby: (event: LobbyEvent) => {
      if (event.type === 'lobby') setLobby(event.lobby)
      else if (event.type === 'started') follow(event.matchId)
      else setEnded(event.type)
    },
    chat: (event: ChatEvent) => chat.receive(event.message),
  }, undefined, () => chat.reload())

  // Deep links such as /play?bot=1 or /play?invite=1 open a sheet once the leader's lobby has loaded.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || lobby?.role !== 'leader') return
    opened.current = true
    const params = new URLSearchParams(search)
    if (params.get('bot')) setSheet('bots')
    else if (params.get('invite')) setSheet('invite')
  }, [lobby?.role, search])

  const run = async (key: string, action: () => Promise<{ lobby: LobbyDetail } | void>) => {
    if (busy) return
    setBusy(key)
    setError(null)
    try {
      const result = await action()
      if (result) setLobby(result.lobby)
    } catch (caught) {
      setError(errorMessage(caught))
      void load()
    } finally {
      setBusy(null)
    }
  }

  if (ended) {
    return (
      <div className="page lobby-page">
        <section className="panel lobby-ended">
          <DoorOpen size={30} />
          <h1>{ended === 'removed' ? 'You left this lobby' : 'This lobby has closed'}</h1>
          <p className="muted-note">{ended === 'removed' ? 'The leader removed you, or you joined another lobby.' : 'Everyone left, or it sat idle for a while.'}</p>
          <div className="page-actions"><Link className="primary-button" to="/play"><Play size={15} /> PLAY</Link><Link className="ghost-button" to="/global"><Globe2 size={15} /> FIND A GAME</Link></div>
        </section>
      </div>
    )
  }
  if (loadError && !lobby) {
    return loadError.status === 404
      ? <section className="panel lobby-ended"><DoorOpen size={30} /><h1>Lobby not found</h1><p className="muted-note">This lobby is private, has closed, or the invite link was replaced. Ask the leader for a new link.</p><div className="page-actions"><Link className="primary-button" to="/play"><Play size={15} /> PLAY</Link><Link className="ghost-button" to="/global"><Globe2 size={15} /> PUBLIC LOBBIES</Link></div></section>
      : <ErrorState message={loadError.message} onRetry={load} />
  }
  if (!lobby) return <Loading label="Opening lobby…" />

  const leader = lobby.role === 'leader'
  const seats = lobby.seats
  const solo = seats.length === 1
  const full = seats.length >= lobby.capacity
  const hasNonAccounts = seats.some((seat) => seat.kind !== 'user')
  const offline = seats.filter((seat) => seat.kind === 'user' && !seat.online && seat.userId !== user?.id)
  const startBlocked = lobby.match
    ? 'A game is in progress.'
    : lobby.ranked && seats.length < 2
      ? 'Ranked games need at least two players.'
      : null
  const update = (patch: LobbyOptionsRequest) => run('settings', () => api.updateLobby(lobby.id, patch))
  const move = (index: number) => {
    if (index === 0) return
    const ids = seats.map((seat) => seat.id)
    ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
    void run('order', () => api.reorderSeats(lobby.id, ids))
  }
  const shuffle = () => {
    const ids = seats.map((seat) => seat.id)
    for (let index = ids.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1))
      ;[ids[index], ids[swap]] = [ids[swap], ids[index]]
    }
    void run('order', () => api.reorderSeats(lobby.id, ids))
  }
  const start = () => run('start', async () => { follow((await api.startLobby(lobby.id)).matchId) })
  const leave = () => run('leave', async () => { await api.leaveLobby(lobby.id); navigate('/', { replace: true }) })

  if (!member) {
    return (
      <div className="page lobby-page">
        <section className="panel lobby-preview">
          <span className="eyebrow">{lobby.visibility === 'public' ? <><Globe2 size={12} /> PUBLIC LOBBY</> : <><Lock size={12} /> PRIVATE LOBBY</>}{lobby.ranked && <> · <Trophy size={12} /> RANKED</>}</span>
          <h1>{lobby.leader.name}’s lobby</h1>
          <p className="lobby-format">{shortFormat(lobby.settings)}</p>
          <div className="lobby-preview-seats">
            {seats.map((seat) => <span key={seat.id}><SeatAvatar seat={seat} size={30} /><b>{seat.name}</b>{seat.rating !== null && <small>{seat.rating}</small>}</span>)}
            <em>{seats.length}/{lobby.capacity} seats</em>
          </div>
          {lobby.match && <p className="muted-note"><Radio size={12} /> A game is in progress. Join to play the next one.</p>}
          {error && <div className="form-error" role="alert">{error}</div>}
          {lobby.canJoin
            ? <button className="primary-button" disabled={busy !== null} onClick={() => run('join', () => api.joinLobby(lobby.id, code))}><UserPlus size={15} /> {busy === 'join' ? 'JOINING…' : 'JOIN LOBBY'}</button>
            : <p className="form-error" role="alert">{lobby.joinBlockedReason}</p>}
          <small className="fine-print">Joining leaves any other lobby you are in. Games already in progress there continue.</small>
        </section>
      </div>
    )
  }

  return (
    <div className="page lobby-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">
            {lobby.visibility === 'public' ? <><Globe2 size={12} /> PUBLIC</> : <><Lock size={12} /> PRIVATE</>} · {lobby.ranked ? <><Trophy size={12} /> RANKED</> : 'UNRANKED'}
            {stream === 'open' && <span className="stream-dot" title="Live updates connected" />}
          </span>
          <h1>{leader ? 'Your lobby' : `${lobby.leader.name}’s lobby`}</h1>
          <p className="lobby-format">{shortFormat(lobby.settings)} · {seats.length}/{lobby.capacity} {lobby.capacity === 1 ? 'seat' : 'seats'}</p>
        </div>
        <div className="page-actions">
          <button className="ghost-button" onClick={() => setSheet('invite')}><UserPlus size={15} /> INVITE</button>
          <button className="ghost-button danger" disabled={busy !== null} onClick={leave}><DoorOpen size={15} /> LEAVE</button>
        </div>
      </div>

      {lobby.match && (
        <Link to={`/matches/${lobby.match.id}`} className="lobby-live">
          <span className="live-pill"><Radio size={11} /> {lobby.match.awaitingConfirmation ? 'RESULT PENDING' : 'GAME IN PROGRESS'}</span>
          <span className="lobby-live-score">{lobby.match.players.map((player) => <span key={player.slot} className={lobby.match?.active === player.slot ? 'at-oche' : ''}><b>{player.name}</b><em>{player.legs}</em><strong>{player.score}</strong><small>AVG {formatAverage(player.average)}</small></span>)}</span>
          <span className="live-card-cta">{lobby.match.players.some((player) => player.userId === user?.id) ? 'BACK TO THE GAME →' : 'WATCH →'}</span>
        </Link>
      )}

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="lobby-grid">
        <div className="lobby-main">
          <section className="panel" aria-labelledby="lobby-players-title">
            <div className="panel-head">
              <h2 id="lobby-players-title">Players</h2>
              <span className="panel-sub">Throw order for the next game · the starter rotates</span>
            </div>
            <ol className="seat-list">
              {seats.map((seat, index) => (
                <li key={seat.id} className="seat">
                  <span className="order-number">{index + 1}</span>
                  <SeatAvatar seat={seat} size={34} />
                  <span className="seat-name">
                    <b>{seat.name}{seat.userId === user?.id && <em> (you)</em>}</b>
                    <small>{seatDetail(seat, lobby.leader.name)}</small>
                  </span>
                  {seat.leader && <span className="role-pill"><Crown size={11} /> LEADER</span>}
                  {seat.rating !== null && <span className="seat-rating" title="Global rating"><small>RATING</small><b>{seat.rating}</b></span>}
                  {leader && <span className="seat-actions">
                    <button className="icon-button" disabled={index === 0 || busy !== null} onClick={() => move(index)} aria-label={`Move ${seat.name} earlier`}><ArrowUp size={14} /></button>
                    {!seat.leader && <button className="icon-button" disabled={busy !== null} onClick={() => run(`remove:${seat.id}`, async () => { await api.removeSeat(lobby.id, seat.id) })} aria-label={`Remove ${seat.name}`}><X size={14} /></button>}
                  </span>}
                </li>
              ))}
              {!full && Array.from({ length: Math.min(lobby.capacity - seats.length, 3) }, (_, index) => (
                <li key={`open-${index}`} className="seat open-seat"><span className="order-number">{seats.length + index + 1}</span><span className="seat-placeholder" /><span className="seat-name"><b>Open seat</b><small>{lobby.visibility === 'public' ? 'Anyone can join from the Global page' : 'Invite someone to fill it'}</small></span></li>
              ))}
            </ol>
            {offline.length > 0 && <p className="field-hint lobby-offline">{offline.map((seat) => seat.name).join(', ')} {offline.length === 1 ? 'is' : 'are'} not connected right now.</p>}
            <div className="seat-add">
              <button className="ghost-button" onClick={() => setSheet('invite')}><UserPlus size={15} /> INVITE FRIENDS</button>
              {leader && <button className="ghost-button" disabled={lobby.ranked || full} onClick={() => setSheet('bots')} title={lobby.ranked ? 'Ranked games are between accounts only' : undefined}><Bot size={15} /> ADD A BOT</button>}
              {leader && seats.length > 1 && <button className="ghost-button" disabled={busy !== null} onClick={shuffle}><Shuffle size={15} /> SHUFFLE</button>}
            </div>
            {leader && !lobby.ranked && !full && <LocalPlayerForm disabled={busy !== null} onAdd={(name) => run('local', () => api.addSeat(lobby.id, { localName: name }))} />}
          </section>

          <section className="panel" aria-labelledby="lobby-game-title">
            <div className="panel-head"><h2 id="lobby-game-title">Game</h2>{!leader && <span className="panel-sub">Set by {lobby.leader.name}</span>}</div>
            <MatchSettingsFields settings={lobby.settings} solo={solo} disabled={!leader} onChange={(settings) => void update({ settings })} />
            <div className="settings-section rule-settings lobby-options">
              <div className="rule-row">
                <div><strong>Who can join</strong><span>{lobby.visibility === 'public' ? 'Listed on the Global page. Anyone signed in can take a free seat.' : 'Only people with your invite link or a direct invite.'}</span></div>
                <Segmented label="Lobby visibility" value={lobby.visibility} disabled={!leader} options={[{ value: 'private', label: 'PRIVATE' }, { value: 'public', label: 'PUBLIC' }]} onChange={(visibility) => void update({ visibility })} />
              </div>
              <div className="rule-row">
                <div><strong>Ranked</strong><span>{lobby.ranked ? 'Results update everyone’s global rating. Accounts only: no bots or local players.' : hasNonAccounts ? 'Casual game. Bots and local players keep it unranked.' : 'Casual game: results count in your stats, not your global rating.'}</span></div>
                <Segmented label="Ranked play" value={lobby.ranked ? 'ranked' : 'casual'} disabled={!leader} options={[{ value: 'casual', label: 'UNRANKED' }, { value: 'ranked', label: 'RANKED', disabled: hasNonAccounts, title: hasNonAccounts ? 'Remove bots and local players to play ranked' : undefined }]} onChange={(value) => void update({ ranked: value === 'ranked' })} />
              </div>
              <div className="rule-row">
                <div><strong>Seats</strong><span>Including bots and local players.</span></div>
                <div className="stepper" role="group" aria-label="Seats">
                  <button type="button" onClick={() => void update({ capacity: lobby.capacity - 1 })} disabled={!leader || busy !== null || lobby.capacity <= Math.max(1, seats.length, lobby.ranked ? 2 : 1)} aria-label="Fewer seats"><Minus size={14} /></button>
                  <span><small>SEATS</small><b>{lobby.capacity}</b></span>
                  <button type="button" onClick={() => void update({ capacity: lobby.capacity + 1 })} disabled={!leader || busy !== null || lobby.capacity >= MAX_SEATS} aria-label="More seats"><Plus size={14} /></button>
                </div>
              </div>
            </div>
          </section>

          {lobby.lastMatch && (
            <section className="panel" aria-label="Last game">
              <div className="panel-head"><h2>Last game</h2></div>
              <div className="match-list"><MatchRow match={lobby.lastMatch} highlightUserId={user?.id} /></div>
            </section>
          )}
        </div>

        <ChatPanel chat={chat} title="Lobby chat" className="lobby-chat" />
      </div>

      <div className={`lobby-start ${leader ? '' : 'waiting'}`}>
        {leader ? (
          <>
            <span className="lobby-start-summary">
              <b>{lobby.ranked ? `Ranked · ${seats.length} ${seats.length === 1 ? 'player' : 'players'}` : solo ? 'Solo practice' : `${seats.length} players`}</b>
              <small>{startBlocked ?? (solo ? 'Track your averages over time. Add a bot or invite friends for a match.' : `${seats[0]?.name} throws first.`)}</small>
            </span>
            <button className="primary-button start-button" disabled={busy !== null || startBlocked !== null} onClick={start}><Play size={16} /> {busy === 'start' ? 'STARTING…' : lobby.ranked ? 'START RANKED GAME' : solo ? 'START SOLO GAME' : 'START GAME'}</button>
          </>
        ) : (
          <span className="lobby-start-summary"><b><Users size={14} /> Waiting for {lobby.leader.name}</b><small>The leader starts the game when everyone is ready. You will join automatically.</small></span>
        )}
      </div>

      {sheet === 'invite' && <InviteSheet lobby={lobby} onClose={() => setSheet(null)} onLobby={setLobby} />}
      {sheet === 'bots' && (
        <Sheet title="Add a bot" eyebrow="HOUSE BOTS · UNRANKED PRACTICE" onClose={() => setSheet(null)} labelledBy="lobby-bots-title" wide>
          <div className="sheet-form">
            <p className="field-hint">Bots throw automatically, one dart at a time. Games with bots are practice: they count in your training stats, never in wins, losses or ratings.</p>
            <BotRoster
              picked={(botId) => seats.some((seat) => seat.botId === botId)}
              disabled={(bot) => busy !== null || (!seats.some((seat) => seat.botId === bot.id) && full)}
              onToggle={(bot) => {
                const seat = seats.find((item) => item.botId === bot.id)
                void run(`bot:${bot.id}`, seat ? async () => { await api.removeSeat(lobby.id, seat.id) } : () => api.addSeat(lobby.id, { botId: bot.id }))
              }}
            />
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="sheet-actions"><span className="sheet-summary">{seats.length}/{lobby.capacity} seats</span><button className="primary-button" onClick={() => setSheet(null)}>DONE</button></div>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function seatDetail(seat: LobbySeat, leaderName: string) {
  if (seat.kind === 'bot') {
    const bot = seat.botId ? getBot(seat.botId) : undefined
    return bot ? `House bot · level ${bot.difficulty} ${bot.level} · ${bot.average} avg` : 'House bot'
  }
  if (seat.kind === 'local') return `Plays on ${leaderName}’s device · unranked`
  const status = seat.online ? 'Online' : 'Offline'
  return seat.rankedMatches ? `${status} · ${seat.rankedMatches} ranked ${seat.rankedMatches === 1 ? 'game' : 'games'}` : `${status} · new to ranked`
}

function SeatAvatar({ seat, size }: { seat: LobbySeat; size: number }) {
  if (seat.botId) return <BotAvatar botId={seat.botId} size={size} />
  return (
    <span className="presence-avatar">
      <Avatar user={{ id: seat.userId ?? seat.id, name: seat.name, avatarUrl: seat.avatarUrl }} size={size} />
      {seat.kind === 'user' && <i className={seat.online ? 'online' : ''} aria-hidden="true" />}
    </span>
  )
}

function LocalPlayerForm({ onAdd, disabled }: { onAdd: (name: string) => Promise<void>; disabled: boolean }) {
  const [name, setName] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = name.trim()
    if (!value) return
    await onAdd(value)
    setName('')
  }
  return (
    <form className="guest-add local-add" onSubmit={submit}>
      <input aria-label="Local player name" placeholder="Someone throwing on your device (unranked)" maxLength={PLAYER_NAME_MAX_LENGTH} value={name} onChange={(event) => setName(event.target.value)} disabled={disabled} />
      <button className="ghost-button" disabled={disabled || !name.trim()}><UserPlus size={15} /> ADD LOCAL PLAYER</button>
    </form>
  )
}
