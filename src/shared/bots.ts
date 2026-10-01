export type BotProfile = {
  id: string
  name: string
  nickname: string
  description: string
  level: string
  difficulty: 1 | 2 | 3 | 4 | 5 | 6
  /** Indicative three-dart average in 501, straight-in / double-out. */
  average: string
  emoji: string
  color: string
}

/** Original fictional opponents, not representations or endorsements of real players. */
export const BOT_ROSTER: readonly BotProfile[] = [
  { id: 'rookie-rue', name: 'Rookie Rue', nickname: 'The Newcomer', description: 'A cheerful beginner who celebrates every dart that finds the board.', level: 'Novice', difficulty: 1, average: '15–25', emoji: '🌱', color: '#84cc16' },
  { id: 'pub-pete', name: 'Pub Pete', nickname: 'Last Orders', description: 'The friendly local regular: a few wild darts, a few lovely surprises.', level: 'Casual', difficulty: 2, average: '30–40', emoji: '🍻', color: '#f59e0b' },
  { id: 'steady-stella', name: 'Steady Stella', nickname: 'The Metronome', description: 'A patient league player who trusts practice more than luck.', level: 'Club', difficulty: 3, average: '45–55', emoji: '⭐', color: '#06b6d4' },
  { id: 'captain-checkout', name: 'Captain Checkout', nickname: 'The Navigator', description: 'A tactical county contender with a map to every finishing double.', level: 'Advanced', difficulty: 4, average: '60–75', emoji: '🧭', color: '#3b82f6' },
  { id: 'velvet-viper', name: 'Velvet Viper', nickname: 'Silent Strike', description: 'A fictional circuit ace whose smooth throw hides a sharp competitive streak.', level: 'Expert', difficulty: 5, average: '80–95', emoji: '🐍', color: '#a855f7' },
  { id: 'the-maximum', name: 'The Maximum', nickname: 'Redline', description: 'A fictional pro-level scoring machine, dangerous but never infallible.', level: 'Pro', difficulty: 6, average: '100–115', emoji: '⚡', color: '#ef4444' },
]

export function getBot(id: string): BotProfile | undefined {
  return BOT_ROSTER.find((bot) => bot.id === id)
}
