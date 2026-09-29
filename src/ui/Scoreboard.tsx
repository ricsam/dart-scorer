import type { ReactNode } from 'react'
import { CircleDot, Pencil } from 'lucide-react'
import { findCheckout, findEasyCheckout } from '../game/checkout'
import type { DartHit, Player } from '../game/types'

type ScoreboardProps = {
  players: Player[]
  active: number
  winner: number | null
  currentVisit: DartHit[]
  doubleIn: boolean
  doubleOut: boolean
  /** Makes player names editable (standalone games). */
  onEditName?: (index: number) => void
  averages?: number[]
  /** Optional decoration shown before a player's name, such as an avatar. */
  renderNameAdornment?: (index: number) => ReactNode
}

export function Scoreboard({ players, active, winner, currentVisit, doubleIn, doubleOut, onEditName, renderNameAdornment, averages }: ScoreboardProps) {
  return (
    <section className={`scoreboard ${players.length > 2 ? 'multi-player' : ''}`}>
      {players.map((player, index) => {
        const dartsAvailable = index === active ? 3 - currentVisit.length : 3
        const checkout = findCheckout(player.score, doubleOut, dartsAvailable, doubleIn && !player.opened)
        const easyCheckout = findEasyCheckout(player.score, doubleOut, dartsAvailable, doubleIn && !player.opened)
        const showEasyRoute = easyCheckout && checkout && easyCheckout.join('|') !== checkout.join('|')
        const average = averages?.[index] ?? (player.turns.length ? player.turns.reduce((sum, value) => sum + value, 0) / player.turns.length : 0)
        return (
          <article className={`player-card ${active === index && winner === null ? 'active' : ''}`} key={player.id}>
            <div className="player-head">
              <div>
                <span className="turn-label">{active === index && winner === null ? (doubleIn && !player.opened ? 'DOUBLE REQUIRED TO START' : 'AT THE OCHE') : 'WAITING'}</span>
                {onEditName ? (
                  <button className="player-name" onClick={() => onEditName(index)}>
                    {player.name} <Pencil size={13} />
                  </button>
                ) : (
                  <span className="player-name static">
                    {renderNameAdornment?.(index)}{player.name}
                  </span>
                )}
              </div>
              <div className="legs"><strong>{player.legs}</strong><span>LEGS</span></div>
            </div>
            <div className="big-score">{player.score}</div>
            <div className="player-stats">
              <span><small>3-DART AVG</small><strong>{average.toFixed(1)}</strong></span>
              <span><small>DARTS</small><strong>{player.darts}</strong></span>
            </div>
            <div className={`checkout ${showEasyRoute ? 'with-easy-route' : ''} ${checkout ? '' : 'no-route'}`}>
              <div className="checkout-heading"><CircleDot size={15} /><span>CHECKOUT ROUTE · {dartsAvailable} DART{dartsAvailable === 1 ? '' : 'S'} LEFT</span></div>
              {checkout ? (
                <>
                  <div className="route">
                    {checkout.map((dart, dartIndex) => (
                      <span key={`${dart}-${dartIndex}`}><b>{dart}</b>{dartIndex < checkout.length - 1 && <i>›</i>}</span>
                    ))}
                  </div>
                  {showEasyRoute && (
                    <div className="easy-route">
                      <small>EASIER</small>
                      <div className="route">
                        {easyCheckout.map((dart, dartIndex) => (
                          <span key={`easy-${dart}-${dartIndex}`}><b>{dart}</b>{dartIndex < easyCheckout.length - 1 && <i>›</i>}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="route-message">{player.score > 170 ? 'Set up your finish' : 'No checkout available'}</div>
              )}
            </div>
          </article>
        )
      })}
    </section>
  )
}
