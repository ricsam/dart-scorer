import type { DartHit, LegResult, Player, Visit } from '../game/types'

type RecentVisitsProps = {
  players: Player[]
  history: Visit[]
  currentVisit: DartHit[]
  legHistory: LegResult[]
  onUndo?: () => void
  onSelectLeg: (legId: string) => void
}

export function RecentVisits({ players, history, currentVisit, legHistory, onUndo, onSelectLeg }: RecentVisitsProps) {
  return (
    <aside className="recent-visits">
      <div className="visits-title"><span>RECENT VISITS</span>{onUndo && (history.length > 0 || currentVisit.length > 0) && <button onClick={onUndo}>UNDO</button>}</div>
      {legHistory.length > 0 && (
        <div className="leg-history">
          <span>LEG HISTORY</span>
          {legHistory.slice().reverse().map((leg) => (
            <button key={leg.id} onClick={() => onSelectLeg(leg.id)} aria-label={`View details for leg ${leg.leg}`}>
              <span><b>LEG {leg.leg}</b><strong>{leg.winnerName}</strong></span>
              <small>Started by {leg.starterName} · Tap for details</small>
              <span className="leg-averages">
                {leg.players.map((legPlayer) => <i key={legPlayer.id}>{legPlayer.name} <b>{legPlayer.average.toFixed(1)}</b></i>)}
              </span>
            </button>
          ))}
        </div>
      )}
      {history.length === 0 ? (
        <p>No scores yet.<br />First player is at the oche.</p>
      ) : (
        <div className="visit-list">
          {history.slice(-4).reverse().map((visit, index) => (
            <div className="visit" key={history.length - index}>
              <span>{players[visit.player]?.name}</span>
              <strong>{visit.bust ? 'BUST' : visit.value}</strong>
              <small>{visit.darts.map((dart) => dart.counts ? dart.label : `(${dart.label})`).join(' · ')} · {visit.previousScore} → {visit.bust ? visit.previousScore : visit.previousScore - visit.value}</small>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
