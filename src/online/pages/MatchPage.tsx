import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, BarChart3, Clock, Eye, Flag, Moon, Play, Radio, RefreshCw, RotateCcw, Sun, Trash2, Trophy, Undo2, WifiOff } from 'lucide-react'
import { computePlayerStats } from '../../game/stats'
import type { GameState, LegResult, RewindTarget } from '../../game/types'
import type { ChatEvent, LobbyEvent, MatchDetail } from '../../shared/api'
import { undoTargetSlot } from '../../shared/match-reducer'
import { Brand } from '../../ui/Brand'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { DartEntry, useDartEntry } from '../../ui/DartEntry'
import { LegDetailModal } from '../../ui/LegDetailModal'
import { RecentVisits } from '../../ui/RecentVisits'
import { Scoreboard } from '../../ui/Scoreboard'
import { useTheme } from '../../ui/useTheme'
import { BotAvatar, BotBadge } from '../BotAvatar'
import { api, errorMessage } from '../api'
import { ChatPanel, ChatToggle, useChat, type ChatController } from '../chat'
import { formatAverage, formatCountdown, formatDateTime, matchContextLabel, rulesLabel } from '../format'
import { useDocumentTitle, useNow } from '../hooks'
import { OnlineLayout } from '../Layout'
import { Link, useRouter } from '../router'
import { useSession } from '../session'
import { useLiveMatch, type LiveMatch } from '../useLiveMatch'
import { Avatar, ErrorState, Loading, Sheet, Toast } from '../ui'
import { MatchStatsTable } from './components/MatchStatsTable'

export function MatchPage({ matchId }: { matchId: string }) {
  const { navigate } = useRouter()
  const [chatOpen, setChatOpen] = useState(false)
  const followed = useRef<string | null>(null)
  const chatRef = useRef<ChatController | null>(null)
  const onLobby = useCallback((event: LobbyEvent) => {
    // The lobby started its next game: everyone still looking at this one comes along.
    if (event.type === 'started' && event.matchId !== matchId && followed.current !== event.matchId) {
      followed.current = event.matchId
      navigate(`/matches/${event.matchId}`)
    }
  }, [matchId, navigate])
  const live = useLiveMatch(matchId, {
    onChat: (event: ChatEvent) => chatRef.current?.receive(event.message),
    onLobby,
    onReconnect: () => chatRef.current?.reload(),
  })
  const canChat = live.match?.canChat ?? false
  const chat = useChat(canChat ? `match-chat:${matchId}` : null, () => api.matchChat(matchId), (body) => api.postMatchChat(matchId, body))
  useLayoutEffect(() => {
    chatRef.current = chat
  })
  const title = live.match ? `${live.match.players.map((player) => player.name).join(' vs ')} — Oche` : 'Match — Oche'
  useDocumentTitle(title)

  if (live.loadError && !live.match) {
    return (
      <OnlineLayout>
        {live.loadError.status === 404
          ? <ErrorState message="This match doesn’t exist, was deleted, or you can’t see it. League matches are visible to league members; lobby games to their players." />
          : <ErrorState message={live.loadError.message} onRetry={live.reload} />}
      </OnlineLayout>
    )
  }
  if (!live.match || !live.state) return <OnlineLayout bare><Loading label="Loading match…" /></OnlineLayout>
  const chatProps = { chat, open: chatOpen, setOpen: setChatOpen }
  if (live.match.status === 'completed') return <OnlineLayout><MatchSummaryView match={live.match} {...chatProps} notice={live.notice} onDismissNotice={live.dismissNotice} /></OnlineLayout>
  return <LiveMatchView live={live} match={live.match} state={live.state} {...chatProps} />
}

type ChatProps = { chat: ChatController; open: boolean; setOpen: (open: boolean) => void }

function statRows(match: MatchDetail, state: GameState, includeCurrentLeg: boolean) {
  const stats = computePlayerStats(state, { includeCurrentLeg })
  return match.players.map((player) => ({
    player,
    stats: stats[player.slot],
    legs: state.players[player.slot]?.legs ?? 0,
    result: match.results?.find((result) => result.slot === player.slot),
  }))
}

/** Add presentation-only bot labels without changing persisted game state. */
function labelBotLeg(leg: LegResult, match: MatchDetail): LegResult {
  const label = (name: string, slot: number) => `${name}${match.players.find((player) => player.slot === slot)?.botId ? ' · BOT' : ''}`
  const winnerSlot = leg.visits[leg.visits.length - 1]?.player
  return { ...leg, winnerName: winnerSlot === undefined ? leg.winnerName : label(leg.winnerName, winnerSlot), starterName: label(leg.starterName, leg.starterIndex), players: leg.players.map((player, slot) => ({ ...player, name: label(player.name, slot) })), playersAtStart: leg.playersAtStart.map((player, slot) => ({ ...player, name: label(player.name, slot) })) }
}

/** Where "back" goes: the league, the lobby the game came from, or home. */
function backTarget(match: MatchDetail) {
  if (match.leagueId) return { to: `/leagues/${match.leagueId}`, label: match.leagueName ?? 'League' }
  if (match.lobbyId) return { to: `/lobbies/${match.lobbyId}`, label: 'Lobby' }
  return { to: '/', label: 'Home' }
}

function ChatDrawer({ chat, open, setOpen, canPost }: ChatProps & { canPost: boolean }) {
  if (!open) return null
  return (
    <>
      <div className="chat-drawer-backdrop" onClick={() => setOpen(false)} />
      <ChatPanel chat={chat} title="Match chat" onClose={() => setOpen(false)} canPost={canPost} className="chat-drawer" />
    </>
  )
}

function LiveMatchView({ live, match, state, chat, open: chatOpen, setOpen: setChatOpen }: { live: LiveMatch; match: MatchDetail; state: GameState } & ChatProps) {
  const [theme, setTheme] = useTheme()
  const { user } = useSession()
  const { navigate } = useRouter()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [forfeitSlot, setForfeitSlot] = useState<number | null>(null)
  const { players, active, legStarter, currentVisit, history, legHistory, winner, matchWinner, doubleIn, doubleOut, game } = state
  const canScore = match.canScore
  const controlled = new Set(match.controlledSlots)
  const hasBots = match.players.some((player) => player.botId)
  const activePlayer = match.players.find((player) => player.slot === active)
  const activeBot = activePlayer?.botId
  const myTurn = canScore && !activeBot && controlled.has(active)
  const undoSlot = undoTargetSlot(state, match.players)
  const canUndo = canScore && undoSlot !== null && controlled.has(undoSlot)
  const mySlot = match.players.find((player) => player.userId === user?.id)?.slot ?? null
  const historyPlayers = players.map((player, index) => ({ ...player, name: `${player.name}${match.players.find((item) => item.slot === index)?.botId ? ' · BOT' : ''}` }))
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null)
  const [rewindTarget, setRewindTarget] = useState<RewindTarget | null>(null)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [dismissedModal, setDismissedModal] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const now = useNow(1000, match.claim !== null || match.autoSaveAt !== null)
  const back = backTarget(match)

  const entry = useDartEntry({
    dartsThrown: currentVisit.length,
    strict: true,
    canSubmit: myTurn && winner === null,
    captureBlocked: !myTurn || confirmResetOpen || rewindTarget !== null || selectedLegId !== null || winner !== null || statsOpen || chatOpen || forfeitSlot !== null,
    onSubmit: (value) => live.dispatch({ type: 'submit', entry: value }),
  })

  const undo = () => {
    if (!canUndo) return
    const last = history[history.length - 1]
    const reopensVisit = !currentVisit.length && last && !last.bust && !last.won && last.darts.some((dart) => !dart.isVisitTotal)
    live.dispatch({ type: 'undo' })
    if (reopensVisit) {
      entry.clear()
      entry.focusSoon()
    }
  }

  const confirmRewind = () => {
    if (!rewindTarget) return
    live.dispatch({ type: 'rewind', legId: rewindTarget.legId, visitIndex: rewindTarget.visitIndex })
    entry.clear()
    setSelectedLegId(null)
    setRewindTarget(null)
    entry.focusSoon()
  }

  const saveResult = async () => {
    setSaving(true)
    await live.finish()
    setSaving(false)
  }

  const selectedLeg = selectedLegId ? legHistory.find((leg) => leg.id === selectedLegId) : undefined
  const rewindLeg = rewindTarget ? legHistory.find((leg) => leg.id === rewindTarget.legId) : undefined
  const rewindVisit = rewindTarget ? rewindLeg?.visits[rewindTarget.visitIndex] : undefined
  const rewindPlayer = rewindVisit ? rewindLeg?.playersAtStart[rewindVisit.player] : undefined
  const modalKey = matchWinner !== null ? `match-${legHistory.length}` : winner !== null ? `leg-${legHistory.length}` : null
  const showResultModal = modalKey !== null && (canScore || dismissedModal !== modalKey)
  const nextStarter = players[(legStarter + 1) % players.length]
  const legScore = players.map((player) => player.legs).join(' – ')
  const matchPlayer = (index: number) => match.players[index]
  const streamLabel = live.stream === 'open' ? (live.syncing ? 'SYNCING' : 'LIVE') : live.stream === 'connecting' ? 'CONNECTING' : 'RECONNECTING'
  const solo = match.players.length === 1
  const activeOnline = activePlayer?.userId ? match.onlineUserIds.includes(activePlayer.userId) : true
  const claimIn = match.claim ? Date.parse(match.claim.at) - now : null
  const autoSaveIn = match.autoSaveAt ? Date.parse(match.autoSaveAt) - now : null
  const turnLabel = activeBot ? 'BOT AT THE OCHE' : myTurn ? (controlled.size > 1 && activePlayer?.userId !== user?.id ? 'SCORING FOR' : 'YOUR THROW') : 'AT THE OCHE'
  const forfeitTarget = forfeitSlot !== null ? match.players[forfeitSlot] : undefined
  const ownForfeit = forfeitSlot !== null && forfeitSlot === mySlot

  return (
    <div className={`app-shell ${theme} online-match`}>
      <header className="topbar">
        <Link to={back.to} className="brand-link" aria-label={`Back to ${back.label}`}><Brand /></Link>
        <div className="match-settings">
          <div className="game-select static"><span>GAME</span><strong>{game}</strong></div>
          <button className="rules-summary" onClick={() => setStatsOpen(true)} aria-label="Open match details">
            <span>{doubleIn ? 'DOUBLE IN' : 'SINGLE IN'}</span>
            <i />
            <span>{doubleOut ? 'DOUBLE OUT' : 'SINGLE OUT'}</span>
            <i />
            <span>{solo ? `${state.legsToWin} ${state.legsToWin === 1 ? 'LEG' : 'LEGS'}` : `FIRST TO ${state.legsToWin}`}</span>
          </button>
        </div>
        <div className="header-actions">
          {canScore && <button className="icon-button" onClick={undo} disabled={!canUndo} aria-label={hasBots ? 'Undo last human dart (including subsequent bot darts)' : 'Undo last dart or visit'} title={undoSlot !== null && !canUndo ? `Only ${match.players[undoSlot]?.name} can undo their darts` : undefined}><Undo2 size={19} /></button>}
          {match.canResetLeg && <button className="icon-button" onClick={() => setConfirmResetOpen(true)} aria-label="Restart leg" disabled={winner !== null}><RotateCcw size={19} /></button>}
          {match.canChat && <ChatToggle chat={chat} onOpen={() => setChatOpen(true)} />}
          <button className="icon-button match-stats-button" onClick={() => setStatsOpen(true)} aria-label="Match statistics"><BarChart3 size={19} /></button>
          <button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <Link to={back.to} className="icon-button back-button" aria-label={`Back to ${back.label}`}><ArrowLeft size={19} /></Link>
        </div>
      </header>

      <main>
        <Scoreboard
          players={players}
          averages={computePlayerStats(state).map((stats) => stats.average)}
          active={active}
          winner={winner}
          currentVisit={currentVisit}
          doubleIn={doubleIn}
          doubleOut={doubleOut}
          renderNameAdornment={(index) => {
            const player = matchPlayer(index)
            if (player?.botId) return <><BotAvatar botId={player.botId} size={18} className="name-avatar" /><BotBadge botId={player.botId} /></>
            if (!player) return null
            const offline = player.userId && match.lobbyId !== null && !match.onlineUserIds.includes(player.userId)
            return <><Avatar user={{ id: player.userId ?? `guest-${index}`, name: player.name, avatarUrl: player.avatarUrl }} size={18} className="name-avatar" />{offline && <span className="offline-flag" title="Not connected"><WifiOff size={11} /></span>}</>
          }}
        />

        <section className="scoring-zone">
          <div className="turn-context">
            <span className="status-dot" />
            <span>{turnLabel}</span>
            <strong>{players[active]?.name.toUpperCase()}</strong>
            <em className={`live-flag ${live.stream === 'open' ? '' : 'offline'}`}><Radio size={9} /> {streamLabel}</em>
          </div>

          {myTurn ? (
            <DartEntry entry={entry} currentVisit={currentVisit} />
          ) : (
            <div className={`calculator dart-entry spectator-panel ${activeBot ? 'bot-throwing-panel' : ''}`}>
              <div className="visit-progress">
                <span>THIS VISIT</span>
                <div className="dart-slots">
                  {[0, 1, 2].map((index) => (
                    <span className={currentVisit[index] ? 'filled' : index === currentVisit.length ? 'next' : ''} key={index}>
                      {currentVisit[index]?.label ?? `DART ${index + 1}`}
                    </span>
                  ))}
                </div>
                <strong>{currentVisit.reduce((sum, hit) => sum + (hit.counts ? hit.value : 0), 0)}</strong>
              </div>
              {activeBot ? (
                <div className="spectator-note bot-throwing-note" role="status"><BotAvatar botId={activeBot} size={48} /><span><b>{players[active]?.name}{winner !== null ? ' has finished.' : live.stream !== 'open' ? ' · reconnecting…' : ' is throwing…'}</b><br />{winner !== null ? 'Waiting for the next leg.' : 'Darts arrive automatically. Sit back and watch the visit unfold.'}</span></div>
              ) : canScore ? (
                <div className="spectator-note waiting-note" role="status">
                  {activePlayer && <Avatar user={{ id: activePlayer.userId ?? `guest-${active}`, name: activePlayer.name, avatarUrl: activePlayer.avatarUrl }} size={44} />}
                  <span>
                    <b>{winner !== null ? 'Leg finished.' : `${activePlayer?.name ?? 'Your opponent'} is at the oche.`}</b><br />
                    {winner !== null ? 'Waiting for the next leg to start.' : activeOnline ? 'Their darts appear here as they enter them on their device.' : `${activePlayer?.name} is not connected right now.`}
                    {match.claim && winner === null && claimIn !== null && (claimIn > 0
                      ? <small className="claim-note"><Clock size={11} /> If nothing happens for 3 minutes you can claim the match ({formatCountdown(claimIn)}).</small>
                      : <button className="ghost-button danger claim-button" onClick={() => setForfeitSlot(match.claim!.slot)}><Flag size={14} /> CLAIM THE WIN</button>)}
                  </span>
                </div>
              ) : (
                <div className="spectator-note"><Eye size={16} /><span><b>Watching live.</b> {match.leagueId ? 'Only the match’s players, its creator and the league host can score.' : 'Each player enters their own darts.'}</span></div>
              )}
            </div>
          )}

          {hasBots && <p className="bot-match-note">TRAINING · Separate practice stats only. No wins, losses or ratings affected.{canScore && ' Undo returns to the last human dart, removing any later bot darts.'}</p>}
          {!hasBots && solo && <p className="bot-match-note">SOLO PRACTICE · Saved to your training stats so you can follow your average over time.</p>}
          {match.ranked && <p className="bot-match-note ranked-note"><Trophy size={11} /> RANKED · The result updates both players’ global ratings. Players enter and undo only their own darts.</p>}
          <RecentVisits
            players={historyPlayers}
            history={history}
            currentVisit={currentVisit}
            legHistory={legHistory.map((leg) => labelBotLeg(leg, match))}
            onUndo={canUndo ? undo : undefined}
            onSelectLeg={setSelectedLegId}
          />
        </section>
      </main>

      <footer><span>{players.length} {players.length === 1 ? 'PLAYER' : 'PLAYERS'}</span><i /> <span>{solo ? `${state.legsToWin} ${state.legsToWin === 1 ? 'LEG' : 'LEGS'}` : `FIRST TO ${state.legsToWin} ${state.legsToWin === 1 ? 'LEG' : 'LEGS'}`}</span><i /> <span>{rulesLabel({ doubleIn, doubleOut })}</span><i /> <span>{game} FORMAT</span><i /> <Link to={back.to}>{matchContextLabel(match, match.leagueName).toUpperCase()}</Link></footer>

      {live.notice && <Toast message={live.notice} onDismiss={live.dismissNotice} tone="error" />}
      <ChatDrawer chat={chat} open={chatOpen} setOpen={setChatOpen} canPost={match.canChat} />

      {selectedLeg && (
        <LegDetailModal
          leg={labelBotLeg(selectedLeg, match)}
          onClose={() => setSelectedLegId(null)}
          onSelectVisit={match.canResetLeg ? (visitIndex) => setRewindTarget({ legId: selectedLeg.id, visitIndex }) : undefined}
        />
      )}

      {rewindTarget && rewindLeg && rewindVisit && rewindPlayer && (
        <ConfirmDialog
          icon={<RotateCcw size={30} />}
          eyebrow="LOAD PAST VISIT"
          title={`Return to visit ${rewindTarget.visitIndex + 1}?`}
          titleId="rewind-title"
          confirmLabel="LOAD VISIT"
          onCancel={() => setRewindTarget(null)}
          onConfirm={confirmRewind}
          backdropClassName="destructive-backdrop"
          className="rewind-modal"
        >
          The match will return to the start of {rewindPlayer.name}’s visit in leg {rewindLeg.leg} for everyone watching. That visit, every visit after it, later legs, and the current leg will be discarded.{hasBots && ' If a bot is at the oche, automatic throwing resumes immediately.'}
        </ConfirmDialog>
      )}

      {confirmResetOpen && (
        <ConfirmDialog
          icon={<RotateCcw size={30} />}
          eyebrow="RESTART LEG"
          title="Reset the current leg?"
          titleId="reset-title"
          confirmLabel="RESET LEG"
          onCancel={() => setConfirmResetOpen(false)}
          onConfirm={() => { live.dispatch({ type: 'resetLeg' }); entry.clear(); setConfirmResetOpen(false) }}
        >
          Scores, darts, and visits for this leg will be cleared for everyone. Completed legs are kept.
        </ConfirmDialog>
      )}

      {statsOpen && (
        <Sheet title="Match statistics" eyebrow={`${matchContextLabel(match, match.leagueName).toUpperCase()} · ${game} · ${solo ? `${state.legsToWin} ${state.legsToWin === 1 ? 'LEG' : 'LEGS'}` : `FIRST TO ${state.legsToWin}`}`} onClose={() => setStatsOpen(false)} labelledBy="match-stats-title" wide>
          <MatchStatsTable rows={statRows(match, state, true)} />
          {legHistory.length > 0 && <div className="leg-history">{legHistory.map((leg) => <button key={leg.id} onClick={() => { setStatsOpen(false); setSelectedLegId(leg.id) }}>LEG {leg.leg} · {leg.winnerName}</button>)}</div>}
          <div className="match-sheet-actions">
            {match.canConcede && mySlot !== null && <button className="ghost-button danger" onClick={() => { setStatsOpen(false); setForfeitSlot(mySlot) }}><Flag size={14} /> CONCEDE MATCH</button>}
            {match.canDelete && <button className="ghost-button danger" onClick={() => { setStatsOpen(false); setDeleteOpen(true) }}><Trash2 size={14} /> ABANDON MATCH</button>}
          </div>
          <p className="table-footnote">Includes the leg in progress. Started {formatDateTime(match.createdAt)} by {match.createdBy.name}.{match.ranked && ' Ranked games can’t be abandoned: concede, or claim the win if your opponent stops playing.'}</p>
        </Sheet>
      )}

      {deleteOpen && <ConfirmDialog icon={<Trash2 size={30} />} eyebrow="ABANDON MATCH" title="Abandon this match?" titleId="abandon-title" confirmLabel="ABANDON" onCancel={() => setDeleteOpen(false)} onConfirm={async () => {
        try { await api.deleteMatch(match.id); navigate(back.to) } catch (caught) { setDeleteError(errorMessage(caught)) }
      }}>This unfinished match will be removed. No result will count toward any stats or ratings.{deleteError && <><br />{deleteError}</>}</ConfirmDialog>}

      {forfeitSlot !== null && forfeitTarget && (
        <ConfirmDialog
          icon={<Flag size={30} />}
          eyebrow={ownForfeit ? 'CONCEDE' : 'CLAIM THE WIN'}
          title={ownForfeit ? 'Concede this match?' : `Claim the match from ${forfeitTarget.name}?`}
          titleId="forfeit-title"
          confirmLabel={ownForfeit ? 'CONCEDE' : 'CLAIM WIN'}
          onCancel={() => setForfeitSlot(null)}
          onConfirm={async () => { const slot = forfeitSlot; setForfeitSlot(null); await live.forfeit(slot) }}
        >
          {ownForfeit
            ? `The match ends now and you finish last.${match.ranked ? ' Your global rating changes as for a loss.' : ''} Completed legs count in everyone’s statistics.`
            : `${forfeitTarget.name} hasn’t thrown for three minutes. The match ends now with ${forfeitTarget.name} last.${match.ranked ? ' Ratings update as for any result.' : ''}`}
        </ConfirmDialog>
      )}

      {showResultModal && winner !== null && (
        <div className="modal-backdrop winner-backdrop">
          <div className={`winner-modal ${matchWinner !== null ? 'match-complete' : ''}`}>
            <Trophy size={38} />
            <span>{matchWinner !== null ? (solo ? 'PRACTICE COMPLETE' : 'MATCH COMPLETE') : 'LEG COMPLETE'}</span>
            <h2>{solo && matchWinner !== null ? `${players[0].name} played ${state.legsToWin} ${state.legsToWin === 1 ? 'leg' : 'legs'}` : `${players[winner].name} ${matchWinner !== null ? 'wins the match!' : 'wins!'}`}</h2>
            {matchWinner !== null ? (
              <>
                <p>{solo ? `${state.legsToWin} ${state.legsToWin === 1 ? 'leg' : 'legs'} · 3-dart average ${formatAverage(computePlayerStats(state, { includeCurrentLeg: false })[0]?.average)}. Save it to your training stats.` : `Final score ${legScore}. ${hasBots ? 'Save this training result to keep your practice statistics. Wins, losses and ratings are unchanged.' : match.leagueId ? 'Save the result to update the league leaderboard.' : match.ranked ? 'Save the result to update global ratings.' : 'Save the result to your stats.'}`}</p>
                <MatchStatsTable rows={statRows(match, state, false)} />
                {autoSaveIn !== null && <p className="autosave-note"><Clock size={12} /> Saved automatically in {formatCountdown(autoSaveIn)} unless someone undoes the last darts.</p>}
              </>
            ) : (
              <p>Clean finish. Legs {legScore}. {solo ? 'On to the next one.' : `${nextStarter?.name} starts the next leg.`}</p>
            )}
            {canScore ? (
              <div className="winner-actions">
                {matchWinner !== null
                  ? <button onClick={saveResult} disabled={saving || live.syncing}>{saving ? 'SAVING…' : 'SAVE RESULT'}</button>
                  : <button onClick={() => { live.dispatch({ type: 'nextLeg' }); entry.clear() }}>START NEXT LEG</button>}
                {canUndo && <button className="secondary" onClick={undo}><Undo2 size={14} /> {hasBots ? 'UNDO LAST HUMAN DART' : 'UNDO LAST VISIT'}</button>}
              </div>
            ) : (
              <div className="winner-actions">
                <p className="waiting">{matchWinner !== null ? 'Waiting for a player to save the result…' : 'Waiting for the next leg to start…'}</p>
                <button className="secondary" onClick={() => setDismissedModal(modalKey)}>VIEW BOARD</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function MatchSummaryView({ match, chat, open: chatOpen, setOpen: setChatOpen, notice, onDismissNotice }: { match: MatchDetail; notice: string | null; onDismissNotice: () => void } & ChatProps) {
  const { navigate } = useRouter()
  const { user } = useSession()
  const state = match.state
  const hasBots = match.players.some((player) => player.botId)
  const solo = match.players.length === 1
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rows = statRows(match, state, false).sort((a, b) => (a.result?.placing ?? 9) - (b.result?.placing ?? 9) || a.player.slot - b.player.slot)
  const winnerRow = rows.find((row) => row.result?.won) ?? null
  const selectedLeg = selectedLegId ? state.legHistory.find((leg) => leg.id === selectedLegId) : undefined
  const back = backTarget(match)
  const forfeiter = match.forfeitSlot !== null ? match.players[match.forfeitSlot] : null
  const mine = rows.find((row) => row.player.userId === user?.id)
  const legs = rows.map((row) => row.legs).join('–')
  const headline = solo
    ? `Practice: ${formatAverage(rows[0]?.stats.average)} average`
    : winnerRow ? `${winnerRow.player.name} won ${legs}` : `Drawn at ${legs}`

  const rematch = async () => {
    setBusy(true)
    setError(null)
    try {
      if (match.leagueId) {
        const order = [...match.players.slice(1), match.players[0]]
        const { match: created } = await api.createMatch(match.leagueId, {
          players: order.map((player) => player.botId ? { botId: player.botId } : player.userId ? { userId: player.userId } : player.guestId ? { guestId: player.guestId } : { guestName: player.name }),
          settings: match.settings,
        })
        navigate(`/matches/${created.id}`)
      } else if (match.lobbyId) {
        const { matchId } = await api.startLobby(match.lobbyId)
        navigate(`/matches/${matchId}`)
      }
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await api.deleteMatch(match.id)
      navigate(back.to, { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  const leaderOfLobby = match.lobbyId !== null && match.createdBy.id === user?.id

  return (
    <div className="page match-summary">
      <div className="page-head">
        <div>
          <span className="eyebrow"><Link to={back.to} className="crumb">{matchContextLabel(match, match.leagueName).toUpperCase()}</Link> / {match.completedAt ? formatDateTime(match.completedAt).toUpperCase() : 'MATCH'}</span>
          <h1><Trophy size={26} className="title-icon" /> {headline}</h1>
          <div className="league-meta">{match.settings.game} · {rulesLabel(match.settings)} · {solo ? `${match.settings.legsToWin} ${match.settings.legsToWin === 1 ? 'LEG' : 'LEGS'}` : `FIRST TO ${match.settings.legsToWin}`}{forfeiter && <> · {forfeiter.name.toUpperCase()} {match.forfeitSlot !== null && mine?.player.slot === match.forfeitSlot ? 'CONCEDED' : 'FORFEITED'}</>}</div>
        </div>
        <div className="page-actions">
          <Link className="ghost-button" to={back.to}><ArrowLeft size={16} /> {match.leagueId ? 'LEAGUE' : match.lobbyId ? 'LOBBY' : 'HOME'}</Link>
          {match.canChat && <button className="ghost-button" onClick={() => setChatOpen(true)}>CHAT{chat.unread > 0 && ` (${chat.unread})`}</button>}
          {match.leagueId && <button className="primary-button" onClick={rematch} disabled={busy}><RefreshCw size={16} /> REMATCH</button>}
          {leaderOfLobby && <button className="primary-button" onClick={rematch} disabled={busy}><Play size={16} /> PLAY AGAIN</button>}
          {!match.leagueId && !match.lobbyId && <Link className="primary-button" to="/play"><Play size={16} /> PLAY</Link>}
        </div>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {match.lobbyId && !leaderOfLobby && <p className="muted-note"><Radio size={12} /> When {match.createdBy.name} starts the next game in the lobby, you join it automatically.</p>}

      {hasBots && <p className="bot-match-note">BOT MATCH · Training for everyone. Practice statistics saved separately; wins, losses and ratings unchanged.</p>}
      {solo && !hasBots && <p className="bot-match-note">SOLO PRACTICE · Saved to your training stats. <Link to="/me">See your progress →</Link></p>}
      {forfeiter && <p className="bot-match-note">{forfeiter.name} {mine?.player.slot === match.forfeitSlot ? 'conceded' : 'conceded or stopped playing'}. Completed legs count in everyone’s statistics.</p>}
      <section className="panel">
        <div className="panel-head"><h2>Scorecard</h2>{match.ranked && <span className="lobby-badge ranked"><Trophy size={9} /> RANKED</span>}</div>
        <MatchStatsTable rows={rows} showRatings={!hasBots && !solo} ratingLabel={match.ranked ? 'Global rating' : 'League rating'} />
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Legs</h2><span className="panel-count">{state.legHistory.length}</span></div>
        {state.legHistory.length === 0 ? <p className="muted-note">No leg was completed.</p> : (
          <div className="leg-cards">
            {state.legHistory.map((leg) => {
              const winningVisit = leg.visits[leg.visits.length - 1]
              const winnerIndex = winningVisit?.player ?? 0
              const winnerDarts = leg.players[winnerIndex]?.darts
              return (
                <button key={leg.id} className="leg-card" onClick={() => setSelectedLegId(leg.id)} aria-label={`View details for leg ${leg.leg}`}>
                  <small>LEG {leg.leg}</small>
                  <b>{leg.winnerName}{match.players.find((player) => player.slot === winnerIndex)?.botId && ' · BOT'}</b>
                  <span>{winnerDarts} darts · out {winningVisit?.previousScore} ({leg.winningDarts})</span>
                  <span className="leg-averages">{leg.players.map((player) => <i key={player.id}>{player.name} <b>{player.average.toFixed(1)}</b></i>)}</span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {match.canDelete && (
        <div className="danger-zone">
          <button className="ghost-button danger" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> DELETE {match.practice ? 'PRACTICE GAME' : 'MATCH'}</button>
        </div>
      )}

      {notice && <Toast message={notice} onDismiss={onDismissNotice} tone="error" />}
      <ChatDrawer chat={chat} open={chatOpen} setOpen={setChatOpen} canPost={match.canChat} />
      {selectedLeg && <LegDetailModal leg={labelBotLeg(selectedLeg, match)} onClose={() => setSelectedLegId(null)} />}
      {confirmDelete && (
        <ConfirmDialog
          icon={<Trash2 size={30} />}
          eyebrow="DELETE MATCH"
          title="Delete this match?"
          titleId="delete-match-title"
          confirmLabel={busy ? 'DELETING…' : 'DELETE'}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={remove}
          busy={busy}
        >
          {match.practice ? 'This practice game and its statistics are removed from your training history.' : 'The result is removed from the league history and every rating is recalculated without it.'}
        </ConfirmDialog>
      )}
    </div>
  )
}
