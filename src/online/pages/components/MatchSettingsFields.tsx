import { Minus, Plus } from 'lucide-react'
import { GAMES } from '../../../game/engine'
import type { MatchSettings } from '../../../shared/api'
import { Segmented } from '../../ui'

export const MAX_LEGS = 11

/** Game, in/out rules and match length. `solo` words the length as a number of legs. */
export function MatchSettingsFields({ settings, onChange, disabled = false, solo = false }: {
  settings: MatchSettings
  onChange: (settings: MatchSettings) => void
  disabled?: boolean
  solo?: boolean
}) {
  const set = (patch: Partial<MatchSettings>) => { if (!disabled) onChange({ ...settings, ...patch }) }
  return (
    <div className="settings-section rule-settings match-settings-fields">
      <div className="rule-row">
        <div><strong>Game</strong><span>Starting score for every leg.</span></div>
        <Segmented label="Game" value={settings.game} options={GAMES.map((game) => ({ value: game, label: game }))} onChange={(game) => set({ game })} disabled={disabled} />
      </div>
      <div className="rule-row">
        <div><strong>Starting rule</strong><span>{settings.doubleIn ? 'Scoring begins only after hitting a double.' : 'Every scoring dart counts immediately.'}</span></div>
        <Segmented label="Starting rule" value={settings.doubleIn ? 'double' : 'single'} options={[{ value: 'single', label: 'SINGLE IN' }, { value: 'double', label: 'DOUBLE IN' }]} onChange={(value) => set({ doubleIn: value === 'double' })} disabled={disabled} />
      </div>
      <div className="rule-row">
        <div><strong>Checkout rule</strong><span>{settings.doubleOut ? 'The final dart must be a double or inner bull.' : 'Any dart that reaches exactly zero wins.'}</span></div>
        <Segmented label="Checkout rule" value={settings.doubleOut ? 'double' : 'single'} options={[{ value: 'single', label: 'SINGLE OUT' }, { value: 'double', label: 'DOUBLE OUT' }]} onChange={(value) => set({ doubleOut: value === 'double' })} disabled={disabled} />
      </div>
      <div className="rule-row">
        <div><strong>Match length</strong><span>{solo ? `Play ${settings.legsToWin} ${settings.legsToWin === 1 ? 'leg' : 'legs'}.` : `First player to win ${settings.legsToWin} ${settings.legsToWin === 1 ? 'leg' : 'legs'} wins the match.`}</span></div>
        <div className="stepper" role="group" aria-label="Legs to win">
          <button type="button" onClick={() => set({ legsToWin: Math.max(1, settings.legsToWin - 1) })} disabled={disabled || settings.legsToWin <= 1} aria-label="Fewer legs"><Minus size={14} /></button>
          <span><small>{solo ? 'LEGS' : 'FIRST TO'}</small><b>{settings.legsToWin}</b></span>
          <button type="button" onClick={() => set({ legsToWin: Math.min(MAX_LEGS, settings.legsToWin + 1) })} disabled={disabled || settings.legsToWin >= MAX_LEGS} aria-label="More legs"><Plus size={14} /></button>
        </div>
      </div>
    </div>
  )
}
