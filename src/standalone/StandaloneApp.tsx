import { useEffect, useReducer, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  Moon,
  Plus,
  RotateCcw,
  Settings2,
  Sun,
  Trash2,
  Trophy,
  Undo2,
  Users,
  X,
} from 'lucide-react'
import { createGameState, GAMES, gameReducer, MAX_PLAYERS } from '../game/engine'
import type { RewindTarget } from '../game/types'
import { Brand } from '../ui/Brand'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { DartEntry, useDartEntry } from '../ui/DartEntry'
import { LegDetailModal } from '../ui/LegDetailModal'
import { RecentVisits } from '../ui/RecentVisits'
import { Scoreboard } from '../ui/Scoreboard'
import { useTheme } from '../ui/useTheme'

function initialGame() {
  return createGameState({ game: 101, doubleIn: false, doubleOut: true, players: [{ name: 'Alex' }, { name: 'Jamie' }] })
}

type StandaloneAppProps = {
  /** Account entry point rendered at the end of the header actions. */
  accountAction?: ReactNode
  /** Extra settings shown at the top of the settings dialog. */
  accountSettings?: ReactNode
}

export function StandaloneApp({ accountAction, accountSettings }: StandaloneAppProps) {
  const [state, dispatch] = useReducer(gameReducer, undefined, initialGame)
  const { game, doubleIn, doubleOut, players, active, legStarter, currentVisit, history, legHistory, winner } = state
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)
  const [rewindTarget, setRewindTarget] = useState<RewindTarget | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [draftName, setDraftName] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setTheme] = useTheme()

  const entry = useDartEntry({
    dartsThrown: currentVisit.length,
    canSubmit: winner === null,
    captureBlocked: editing !== null || settingsOpen || confirmResetOpen || rewindTarget !== null || selectedLegId !== null || winner !== null,
    onSubmit: (value) => dispatch({ type: 'submit', entry: value }),
  })

  useEffect(() => {
    const closeModal = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false)
        setSelectedLegId(null)
        setConfirmResetOpen(false)
        setRewindTarget(null)
      }
    }
    window.addEventListener('keydown', closeModal)
    return () => window.removeEventListener('keydown', closeModal)
  }, [])

  const startNextLeg = () => {
    dispatch({ type: 'nextLeg' })
    entry.clear()
  }

  const changeGame = (value: number) => {
    dispatch({ type: 'setGame', game: value })
    entry.clear()
  }

  const undo = () => {
    const last = history[history.length - 1]
    const reopensVisit = !currentVisit.length && last && !last.bust && !last.won && last.darts.some((dart) => !dart.isVisitTotal)
    dispatch({ type: 'undo' })
    if (reopensVisit) {
      entry.clear()
      entry.focusSoon()
    }
  }

  const confirmReset = () => {
    dispatch({ type: 'resetLeg' })
    entry.clear()
    setConfirmResetOpen(false)
  }

  const confirmRewind = () => {
    if (!rewindTarget) return
    dispatch({ type: 'rewind', legId: rewindTarget.legId, visitIndex: rewindTarget.visitIndex })
    entry.clear()
    setSelectedLegId(null)
    setRewindTarget(null)
    entry.focusSoon()
  }

  const saveName = () => {
    if (editing === null || !draftName.trim()) return
    dispatch({ type: 'renamePlayer', index: editing, name: draftName.trim() })
    setEditing(null)
  }

  const updatePlayerName = (index: number, name: string) => dispatch({ type: 'renamePlayer', index, name })

  const removePlayer = (index: number) => {
    if (players.length <= 2) return
    if (index === active) entry.clear()
    dispatch({ type: 'removePlayer', index })
  }

  const selectedLeg = selectedLegId ? legHistory.find((leg) => leg.id === selectedLegId) : undefined
  const rewindLeg = rewindTarget ? legHistory.find((leg) => leg.id === rewindTarget.legId) : undefined
  const rewindVisit = rewindTarget ? rewindLeg?.visits[rewindTarget.visitIndex] : undefined
  const rewindPlayer = rewindVisit ? rewindLeg?.playersAtStart[rewindVisit.player] : undefined

  return (
    <div className={`app-shell ${theme}`}>
      <header className="topbar">
        <Brand />
        <div className="match-settings">
          <label className="game-select">
            <span>GAME</span>
            <select value={game} onChange={(event) => changeGame(Number(event.target.value))}>
              {GAMES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <ChevronDown size={15} />
          </label>
          <button className="rules-summary" onClick={() => setSettingsOpen(true)} aria-label="Open in and out rule settings">
            <span>{doubleIn ? 'DOUBLE IN' : 'SINGLE IN'}</span>
            <i />
            <span>{doubleOut ? 'DOUBLE OUT' : 'SINGLE OUT'}</span>
          </button>
        </div>
        <div className="header-actions">
          <button className="icon-button" onClick={undo} disabled={!history.length && !currentVisit.length} aria-label="Undo last dart or visit"><Undo2 size={19} /></button>
          <button className="icon-button" onClick={() => setConfirmResetOpen(true)} aria-label="Restart leg"><RotateCcw size={19} /></button>
          <button className="icon-button player-settings-button" onClick={() => setSettingsOpen(true)} aria-label={`Manage ${players.length} players`}>
            <Users size={19} /><span>{players.length}</span>
          </button>
          <button
            className={`icon-button ${settingsOpen ? 'selected' : ''}`}
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
          ><Settings2 size={19} /></button>
          {accountAction}
        </div>
      </header>

      <main>
        <Scoreboard
          players={players}
          active={active}
          winner={winner}
          currentVisit={currentVisit}
          doubleIn={doubleIn}
          doubleOut={doubleOut}
          onEditName={(index) => { setEditing(index); setDraftName(players[index].name) }}
        />

        <section className="scoring-zone">
          <div className="turn-context">
            <span className="status-dot" />
            <span>SCORING FOR</span>
            <strong>{players[active].name.toUpperCase()}</strong>
          </div>

          <DartEntry entry={entry} currentVisit={currentVisit} />

          <RecentVisits
            players={players}
            history={history}
            currentVisit={currentVisit}
            legHistory={legHistory}
            onUndo={undo}
            onSelectLeg={setSelectedLegId}
          />
        </section>
      </main>

      <footer><span>{players.length} PLAYERS</span><i /> <span>FIRST TO 3 LEGS</span><i /> <span>{doubleIn ? 'DOUBLE IN' : 'SINGLE IN'} · {doubleOut ? 'DOUBLE OUT' : 'SINGLE OUT'}</span><i /> <span>{game} FORMAT</span></footer>

      {selectedLeg && (
        <LegDetailModal
          leg={selectedLeg}
          onClose={() => setSelectedLegId(null)}
          onSelectVisit={(visitIndex) => setRewindTarget({ legId: selectedLeg.id, visitIndex })}
        />
      )}

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
            <div className="settings-modal-head">
              <div>
                <span>MATCH PREFERENCES</span>
                <h2 id="settings-title">Settings</h2>
              </div>
              <button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={19} /></button>
            </div>

            {accountSettings}

            <div className="settings-section">
              <div className="settings-copy">
                <strong>Appearance</strong>
                <span>Choose how Oche looks on this device.</span>
              </div>
              <div className="theme-options" role="group" aria-label="Color theme">
                <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')} aria-pressed={theme === 'dark'}>
                  <Moon size={18} /> Dark
                </button>
                <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')} aria-pressed={theme === 'light'}>
                  <Sun size={18} /> Light
                </button>
              </div>
            </div>

            <div className="settings-section roster-settings">
              <div className="roster-heading">
                <div className="settings-copy">
                  <strong><Users size={14} /> Players</strong>
                  <span>Add up to {MAX_PLAYERS} players for casual games.</span>
                </div>
                <span className="player-count">{players.length}/{MAX_PLAYERS}</span>
              </div>
              <div className="roster-list">
                {players.map((player, index) => (
                  <div className="roster-player" key={player.id}>
                    <span>{index + 1}</span>
                    <input
                      value={player.name}
                      maxLength={18}
                      aria-label={`Player ${index + 1} name`}
                      onChange={(event) => updatePlayerName(index, event.target.value)}
                      onBlur={() => {
                        if (!player.name.trim()) updatePlayerName(index, `Player ${index + 1}`)
                        else updatePlayerName(index, player.name.trim())
                      }}
                    />
                    <button
                      onClick={() => removePlayer(index)}
                      disabled={players.length <= 2}
                      aria-label={`Remove ${player.name || `Player ${index + 1}`}`}
                    ><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
              <button className="add-player" onClick={() => dispatch({ type: 'addPlayer' })} disabled={players.length >= MAX_PLAYERS}>
                <Plus size={16} /> {players.length >= MAX_PLAYERS ? 'PLAYER LIMIT REACHED' : 'ADD PLAYER'}
              </button>
            </div>

            <div className="settings-section match-options">
              <div className="settings-copy">
                <strong>Game format</strong>
                <span>Changing the format starts a fresh leg.</span>
              </div>
              <select value={game} onChange={(event) => changeGame(Number(event.target.value))} aria-label="Game format">
                {GAMES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>

            <div className="settings-section rule-settings">
              <div className="settings-copy">
                <strong>In and out rules</strong>
                <span>Rule changes apply immediately without resetting the leg.</span>
              </div>
              <div className="rule-row">
                <div>
                  <strong>Starting rule</strong>
                  <span>{doubleIn ? 'Scoring begins only after hitting a double.' : 'Every scoring dart counts immediately.'}</span>
                </div>
                <div className="rule-options" role="group" aria-label="Starting rule">
                  <button className={!doubleIn ? 'active' : ''} onClick={() => dispatch({ type: 'setDoubleIn', value: false })} aria-pressed={!doubleIn}>SINGLE IN</button>
                  <button className={doubleIn ? 'active' : ''} onClick={() => dispatch({ type: 'setDoubleIn', value: true })} aria-pressed={doubleIn}>DOUBLE IN</button>
                </div>
              </div>
              <div className="rule-row">
                <div>
                  <strong>Checkout rule</strong>
                  <span>{doubleOut ? 'The final dart must be a double or inner bull.' : 'Any dart that reaches exactly zero wins.'}</span>
                </div>
                <div className="rule-options" role="group" aria-label="Checkout rule">
                  <button className={!doubleOut ? 'active' : ''} onClick={() => dispatch({ type: 'setDoubleOut', value: false })} aria-pressed={!doubleOut}>SINGLE OUT</button>
                  <button className={doubleOut ? 'active' : ''} onClick={() => dispatch({ type: 'setDoubleOut', value: true })} aria-pressed={doubleOut}>DOUBLE OUT</button>
                </div>
              </div>
            </div>
          </section>
        </div>
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
          The game will return to the start of {rewindPlayer.name}’s visit in leg {rewindLeg.leg}. That visit, every visit after it, later legs, and the current leg will be discarded.
        </ConfirmDialog>
      )}

      {editing !== null && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="name-modal" onClick={(event) => event.stopPropagation()}>
            <span>PLAYER {editing + 1}</span>
            <h2>Edit player name</h2>
            <input autoFocus onFocus={(event) => event.currentTarget.select()} maxLength={18} value={draftName} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && saveName()} />
            <div><button onClick={() => setEditing(null)}>Cancel</button><button className="save" onClick={saveName}>Save name</button></div>
          </div>
        </div>
      )}

      {confirmResetOpen && (
        <ConfirmDialog
          icon={<RotateCcw size={30} />}
          eyebrow="RESTART LEG"
          title="Reset the current leg?"
          titleId="reset-title"
          confirmLabel="RESET LEG"
          onCancel={() => setConfirmResetOpen(false)}
          onConfirm={confirmReset}
        >
          Scores, darts, and visits for this leg will be cleared. Completed leg history is kept.
        </ConfirmDialog>
      )}

      {winner !== null && (
        <div className="modal-backdrop winner-backdrop">
          <div className="winner-modal">
            <Trophy size={38} />
            <span>LEG COMPLETE</span>
            <h2>{players[winner].name} wins!</h2>
            <p>Clean finish. {players[(legStarter + 1) % players.length].name} starts the next leg.</p>
            <button onClick={startNextLeg}>START NEXT LEG</button>
          </div>
        </div>
      )}
    </div>
  )
}
