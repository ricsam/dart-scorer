import { Minus, Plus } from 'lucide-react'
import { BOT_ROSTER, type BotProfile } from '../../../shared/bots'
import { BotAvatar } from '../../BotAvatar'

/** The six house bots as toggle cards. */
export function BotRoster({ picked, onToggle, disabled }: { picked: (botId: string) => boolean; onToggle: (bot: BotProfile) => void; disabled: (bot: BotProfile) => boolean }) {
  return (
    <div className="bot-roster" role="group" aria-label="Automatic bot opponents">
      {BOT_ROSTER.map((bot) => {
        const selected = picked(bot.id)
        return <button key={bot.id} type="button" className={`bot-card ${selected ? 'picked' : ''}`} aria-pressed={selected} aria-label={`${selected ? 'Remove' : 'Add'} ${bot.name}, level ${bot.difficulty}, ${bot.level}`} disabled={disabled(bot)} onClick={() => onToggle(bot)}>
          <BotAvatar botId={bot.id} size={48} />
          <span className="bot-card-copy"><small>LEVEL {bot.difficulty} · {bot.level}</small><strong>{bot.name}</strong><em>“{bot.nickname}”</em></span>
          <span className="bot-toggle" aria-hidden="true">{selected ? <Minus size={16} /> : <Plus size={16} />}</span>
          <span className="bot-description">{bot.description}</span>
          <span className="bot-skill"><span aria-hidden="true">{[1, 2, 3, 4, 5, 6].map((level) => <i key={level} className={level <= bot.difficulty ? 'filled' : ''} />)}</span><span>{bot.average} AVG</span></span>
        </button>
      })}
    </div>
  )
}
