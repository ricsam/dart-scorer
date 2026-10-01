import { useState } from 'react'
import { ArrowLeft, BarChart3, Eye, Moon, Radio, RefreshCw, RotateCcw, Sun, Trash2, Trophy, Undo2 } from 'lucide-react'
import { computePlayerStats } from '../../game/stats'
import type { GameState, LegResult, RewindTarget } from '../../game/types'
import type { MatchDetail } from '../../shared/api'
import { Brand } from '../../ui/Brand'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { DartEntry, useDartEntry } from '../../ui/DartEntry'
import { LegDetailModal } from '../../ui/LegDetailModal'
import { RecentVisits } from '../../ui/RecentVisits'
import { Scoreboard } from '../../ui/Scoreboard'
import { useTheme } from '../../ui/useTheme'
import { BotAvatar, BotBadge } from '../BotAvatar'
import { api, errorMessage } from '../api'
import { formatDateTime, rulesLabel } from '../format'
import { useDocumentTitle } from '../hooks'
import { OnlineLayout } from '../Layout'
import { Link, useRouter } from '../router'
import { useLiveMatch, type LiveMatch } from '../useLiveMatch'
import { Avatar, ErrorState, Loading, Sheet, Toast } from '../ui'
import { MatchStatsTable } from './components/MatchStatsTable'

export function MatchPage({ matchId }: { matchId: string }) {
  const live = useLiveMatch(matchId)
  const title = live.match ? `${live.match.players.map((player) => player.name).join(' vs ')} — Oche` : 'Match — Oche'
  useDocumentTitle(title)

  if (live.loadError && !live.match) {
    return (
      <OnlineLayout>
        {live.loadError.status === 404
          ? <ErrorState message="This match doesn’t exist, was deleted, or belongs to a room you are not a member of." />
          : <ErrorState message={live.loadError.message} onRetry={live.reload} />}
      </OnlineLayout>
    )
  }
  if (!live.match || !live.state) return <OnlineLayout bare><Loading label="Loading match…" /></OnlineLayout>
  if (live.match.status === 'completed') return <OnlineLayout><MatchSummaryView match={live.match} /></OnlineLayout>
  return <LiveMatchView live={live} match={live.match} state={live.state} />
}

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

function LiveMatchView({ live, match, state }: { live: LiveMatch; match: MatchDetail; state: GameState }) {
  const [theme, setTheme] = useTheme()
  const { navigate } = useRouter()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { players, active, legStarter, currentVisit, history, legHistory, winner, matchWinner, doubleIn, doubleOut, game } = state
  const canScore = match.canScore
  const hasBots = match.players.some((player) => player.botId)
  const activeBot = match.players.find((player) => player.slot === active)?.botId
  const historyPlayers = players.map((player, index) => ({ ...player, name: `${player.name}${match.players.find((item) => item.slot === index)?.botId ? ' · BOT' : ''}` }))
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null)
  const [rewindTarget, setRewindTarget] = useState<RewindTarget | null>(null)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [dismissedModal, setDismissedModal] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const entry = useDartEntry({
    dartsThrown: currentVisit.length,
    strict: true,
    canSubmit: canScore && !activeBot && winner === null,
    captureBlocked: !canScore || !!activeBot || confirmResetOpen || rewindTarget !== null || selectedLegId !== null || winner !== null || statsOpen,
    onSubmit: (value) => live.dispatch({ type: 'submit', entry: value }),
  })

  const undo = () => {
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

  return (
    <div className={`app-shell ${theme} online-match`}>
      <header className="topbar">
        <Link to={`/rooms/${match.roomId}`} className="brand-link" aria-label={`Back to ${match.roomName}`}><Brand /></Link>
        <div className="match-settings">
          <div className="game-select static"><span>GAME</span><strong>{game}</strong></div>
          <button className="rules-summary" onClick={() => setStatsOpen(true)} aria-label="Open match details">
            <span>{doubleIn ? 'DOUBLE IN' : 'SINGLE IN'}</span>
            <i />
            <span>{doubleOut ? 'DOUBLE OUT' : 'SINGLE OUT'}</span>
            <i />
            <span>FIRST TO {state.legsToWin}</span>
          </button>
        </div>
        <div className="header-actions">
          {canScore && <button className="icon-button" onClick={undo} disabled={!history.length && !currentVisit.length} aria-label={hasBots ? 'Undo last human dart (including subsequent bot darts)' : 'Undo last dart or visit'}><Undo2 size={19} /></button>}
          {canScore && <button className="icon-button" onClick={() => setConfirmResetOpen(true)} aria-label="Restart leg" disabled={winner !== null}><RotateCcw size={19} /></button>}
          <button className="icon-button match-stats-button" onClick={() => setStatsOpen(true)} aria-label="Match statistics"><BarChart3 size={19} /></button>
          <button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <Link to={`/rooms/${match.roomId}`} className="icon-button back-button" aria-label={`Back to ${match.roomName}`}><ArrowLeft size={19} /></Link>
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
            return player?.botId ? <><BotAvatar botId={player.botId} size={18} className="name-avatar" /><BotBadge botId={player.botId} /></> : player ? <Avatar user={{ id: player.userId ?? `guest-${index}`, name: player.name, avatarUrl: player.avatarUrl }} size={18} className="name-avatar" /> : null
          }}
        />

        <section className="scoring-zone">
          <div className="turn-context">
            <span className="status-dot" />
            <span>{activeBot ? 'BOT AT THE OCHE' : canScore ? 'SCORING FOR' : 'AT THE OCHE'}</span>
            <strong>{players[active]?.name.toUpperCase()}</strong>
            <em className={`live-flag ${live.stream === 'open' ? '' : 'offline'}`}><Radio size={9} /> {streamLabel}</em>
          </div>

          {canScore && !activeBot ? (
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
              {activeBot ? <div className="spectator-note bot-throwing-note" role="status"><BotAvatar botId={activeBot} size={48} /><span><b>{players[active]?.name}{winner !== null ? ' has finished.' : live.stream !== 'open' ? ' · reconnecting…' : ' is throwing…'}</b><br />{winner !== null ? 'Waiting for the next leg.' : 'Darts arrive automatically. Sit back and watch the visit unfold.'}</span></div> : <div className="spectator-note"><Eye size={16} /><span><b>Watching live.</b> Scores update as the players enter them. Only the match’s players, its creator and the room host can score.</span></div>}
            </div>
          )}

          {hasBots && <p className="bot-match-note">UNRANKED · Statistics retained.{canScore && ' Undo returns to the last human dart, removing any later bot darts.'}</p>}
          <RecentVisits
            players={historyPlayers}
            history={history}
            currentVisit={currentVisit}
            legHistory={legHistory.map((leg) => labelBotLeg(leg, match))}
            onUndo={canScore ? undo : undefined}
            onSelectLeg={setSelectedLegId}
          />
        </section>
      </main>

      <footer><span>{players.length} PLAYERS</span><i /> <span>FIRST TO {state.legsToWin} {state.legsToWin === 1 ? 'LEG' : 'LEGS'}</span><i /> <span>{rulesLabel({ doubleIn, doubleOut })}</span><i /> <span>{game} FORMAT</span><i /> <Link to={`/rooms/${match.roomId}`}>{match.roomName.toUpperCase()}</Link></footer>

      {live.notice && <Toast message={live.notice} onDismiss={live.dismissNotice} tone="error" />}

      {selectedLeg && (
        <LegDetailModal
          leg={labelBotLeg(selectedLeg, match)}
          onClose={() => setSelectedLegId(null)}
          onSelectVisit={canScore ? (visitIndex) => setRewindTarget({ legId: selectedLeg.id, visitIndex }) : undefined}
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
        <Sheet title="Match statistics" eyebrow={`${match.roomName.toUpperCase()} · ${game} · FIRST TO ${state.legsToWin}`} onClose={() => setStatsOpen(false)} labelledBy="match-stats-title" wide>
          <MatchStatsTable rows={statRows(match, state, true)} />
          {legHistory.length > 0 && <div className="leg-history">{legHistory.map((leg) => <button key={leg.id} onClick={() => { setStatsOpen(false); setSelectedLegId(leg.id) }}>LEG {leg.leg} · {leg.winnerName}</button>)}</div>}
          {match.canDelete && <button className="ghost-button danger" onClick={() => { setStatsOpen(false); setDeleteOpen(true) }}><Trash2 size={14} /> ABANDON MATCH</button>}
          <p className="table-footnote">Includes the leg in progress. Started {formatDateTime(match.createdAt)} by {match.createdBy.name}.</p>
        </Sheet>
      )}

      {deleteOpen && <ConfirmDialog icon={<Trash2 size={30} />} eyebrow="ABANDON MATCH" title="Abandon this match?" titleId="abandon-title" confirmLabel="ABANDON" onCancel={() => setDeleteOpen(false)} onConfirm={async () => {
        try { await api.deleteMatch(match.id); navigate(`/rooms/${match.roomId}`) } catch (caught) { setDeleteError(errorMessage(caught)) }
      }}>This unfinished match will be removed. No result will count toward the leaderboard.{deleteError && <><br />{deleteError}</>}</ConfirmDialog>}

      {showResultModal && winner !== null && (
        <div className="modal-backdrop winner-backdrop">
          <div className={`winner-modal ${matchWinner !== null ? 'match-complete' : ''}`}>
            <Trophy size={38} />
            <span>{matchWinner !== null ? 'MATCH COMPLETE' : 'LEG COMPLETE'}</span>
            <h2>{players[winner].name} {matchWinner !== null ? 'wins the match!' : 'wins!'}</h2>
            {matchWinner !== null ? (
              <>
                <p>Final score {legScore}. {hasBots ? 'Save this unranked result to keep the match statistics. Room ratings are unchanged.' : 'Save the result to update the room leaderboard.'}</p>
                <MatchStatsTable rows={statRows(match, state, false)} />
              </>
            ) : (
              <p>Clean finish. Legs {legScore}. {nextStarter?.name} starts the next leg.</p>
            )}
            {canScore ? (
              <div className="winner-actions">
                {matchWinner !== null
                  ? <button onClick={saveResult} disabled={saving || live.syncing}>{saving ? 'SAVING…' : 'SAVE RESULT'}</button>
                  : <button onClick={() => { live.dispatch({ type: 'nextLeg' }); entry.clear() }}>START NEXT LEG</button>}
                <button className="secondary" onClick={undo}><Undo2 size={14} /> {hasBots ? 'UNDO LAST HUMAN DART' : 'UNDO LAST VISIT'}</button>
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

function MatchSummaryView({ match }: { match: MatchDetail }) {
  const { navigate } = useRouter()
  const state = match.state
  const hasBots = match.players.some((player) => player.botId)
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rows = statRows(match, state, false).sort((a, b) => (a.result?.placing ?? 9) - (b.result?.placing ?? 9) || a.player.slot - b.player.slot)
  const winnerRow = rows.find((row) => row.result?.won) ?? rows[0]
  const selectedLeg = selectedLegId ? state.legHistory.find((leg) => leg.id === selectedLegId) : undefined

  const rematch = async () => {
    setBusy(true)
    setError(null)
    const order = [...match.players.slice(1), match.players[0]]
    try {
      const { match: created } = await api.createMatch(match.roomId, {
        players: order.map((player) => player.botId ? { botId: player.botId } : player.userId ? { userId: player.userId } : player.guestId ? { guestId: player.guestId } : { guestName: player.name }),
        settings: match.settings,
      })
      navigate(`/matches/${created.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await api.deleteMatch(match.id)
      navigate(`/rooms/${match.roomId}`, { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="page match-summary">
      <div className="page-head">
        <div>
          <span className="eyebrow"><Link to={`/rooms/${match.roomId}`} className="crumb">{match.roomName.toUpperCase()}</Link> / {match.completedAt ? formatDateTime(match.completedAt).toUpperCase() : 'MATCH'}</span>
          <h1><Trophy size={26} className="title-icon" /> {winnerRow?.player.name} won {rows.map((row) => row.legs).join('–')}</h1>
          <div className="room-meta">{match.settings.game} · {rulesLabel(match.settings)} · FIRST TO {match.settings.legsToWin}</div>
        </div>
        <div className="page-actions">
          <Link className="ghost-button" to={`/rooms/${match.roomId}`}><ArrowLeft size={16} /> ROOM</Link>
          <button className="primary-button" onClick={rematch} disabled={busy}><RefreshCw size={16} /> REMATCH</button>
        </div>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}

      {hasBots && <p className="bot-match-note">BOT MATCH · Unranked for everyone. Match statistics retained; room ratings unchanged.</p>}
      <section className="panel">
        <div className="panel-head"><h2>Scorecard</h2></div>
        <MatchStatsTable rows={rows} showRatings />
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Legs</h2><span className="panel-count">{state.legHistory.length}</span></div>
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
      </section>

      {match.canDelete && (
        <div className="danger-zone">
          <button className="ghost-button danger" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> DELETE MATCH</button>
        </div>
      )}

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
          {hasBots ? 'This unranked result and its statistics are removed from room history. Room ratings are unchanged.' : 'The result is removed from the room history and every rating is recalculated without it.'}
        </ConfirmDialog>
      )}
    </div>
  )
}
