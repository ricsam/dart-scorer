import { RotateCcw, X } from 'lucide-react'
import type { LegResult } from '../game/types'

type LegDetailModalProps = {
  leg: LegResult
  onClose: () => void
  /** When provided, visits can be selected to rewind the game to that turn. */
  onSelectVisit?: (visitIndex: number) => void
}

export function LegDetailModal({ leg, onClose, onSelectVisit }: LegDetailModalProps) {
  const winnerIndex = leg.visits[leg.visits.length - 1]?.player
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="leg-detail-modal" role="dialog" aria-modal="true" aria-labelledby="leg-detail-title" onClick={(event) => event.stopPropagation()}>
        <div className="settings-modal-head">
          <div>
            <span>LEG {leg.leg} · STARTED BY {leg.starterName.toUpperCase()}</span>
            <h2 id="leg-detail-title">{leg.winnerName} won</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close leg details"><X size={19} /></button>
        </div>
        {onSelectVisit && <p className="leg-rewind-hint"><RotateCcw size={13} /> Select a visit to return the game to the start of that turn.</p>}
        <div className="leg-detail-players">
          {leg.players.map((legPlayer, playerIndex) => {
            const isWinner = winnerIndex === undefined ? legPlayer.name === leg.winnerName : playerIndex === winnerIndex
            return (
              <article className={isWinner ? 'winner' : ''} key={legPlayer.id}>
                <div className="leg-player-summary">
                  <div><strong>{legPlayer.name}</strong><span>{isWinner ? 'LEG WINNER' : `${legPlayer.score} LEFT`}</span></div>
                  <div><small>3-DART AVG</small><b>{legPlayer.average.toFixed(1)}</b></div>
                  <div><small>DARTS</small><b>{legPlayer.darts}</b></div>
                </div>
                <div className="leg-visit-list">
                  {legPlayer.visits.length ? legPlayer.visits.map((visit) => onSelectVisit ? (
                    <button
                      type="button"
                      key={`${legPlayer.id}-${visit.visitIndex}`}
                      onClick={() => onSelectVisit(visit.visitIndex)}
                      aria-label={`Load visit ${visit.visitIndex + 1} by ${legPlayer.name}`}
                    >
                      <span>VISIT {visit.visitIndex + 1}</span>
                      <strong>{visit.bust ? 'BUST' : visit.value}</strong>
                      <small>{visit.darts.join(' · ')}</small>
                      <i>{visit.previousScore} → {visit.remaining}</i>
                      <b><RotateCcw size={12} /> LOAD</b>
                    </button>
                  ) : (
                    <div className="leg-visit-row" key={`${legPlayer.id}-${visit.visitIndex}`}>
                      <span>VISIT {visit.visitIndex + 1}</span>
                      <strong>{visit.bust ? 'BUST' : visit.value}</strong>
                      <small>{visit.darts.join(' · ')}</small>
                      <i>{visit.previousScore} → {visit.remaining}</i>
                    </div>
                  )) : <p>No darts thrown in this leg.</p>}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
