import { describe, expect, it } from 'vitest'
import { botDart } from '../../server/bot-darts'
import { BOT_ROSTER, getBot, type BotProfile } from '../../src/shared/bots'
import { createGameState, gameReducer, GAMES } from '../../src/game/engine'
import { evaluateOnlineEntry } from '../../src/game/entry'

function seeded(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
}
const legal = /^(MISS|BULL|25|[DT]?(?:[1-9]|1[0-9]|20))$/
function leg(bot: BotProfile, seed: number, game = 501, doubleIn = false, doubleOut = true) {
  let state = createGameState({ game, doubleIn, doubleOut, players: [{ id: 'bot', name: bot.name }, { id: 'passive', name: 'Passive' }] })
  const random = seeded(seed)
  for (let step = 0; step < 6000 && state.winner === null; step++) {
    const entry = state.active === 0 ? botDart(state, bot, random) : 'MISS'
    if (!legal.test(entry)) throw new Error(`Impossible dart: ${entry}`)
    const next = gameReducer(state, { type: 'submit', entry })
    if (next === state) throw new Error('Dart failed to advance state')
    state = next
  }
  expect(state.winner, `${bot.id}, seed ${seed}, ${game}, in=${doubleIn}, out=${doubleOut}`).toBe(0)
  return state
}

describe('fictional bot roster', () => {
  it('has stable unique identities in ascending skill order', () => {
    expect(BOT_ROSTER.map((bot) => bot.id)).toEqual(['rookie-rue', 'pub-pete', 'steady-stella', 'captain-checkout', 'velvet-viper', 'the-maximum'])
    BOT_ROSTER.forEach((bot, index) => {
      expect(bot.name.length).toBeLessThanOrEqual(18)
      expect(bot.difficulty).toBe(index + 1)
      expect(getBot(bot.id)).toBe(bot)
    })
    expect(getBot('unknown')).toBeUndefined()
  })
})

describe('bot darts', () => {
  it('uses opening doubles, single/double outs, darts remaining and setup shots', () => {
    const state = createGameState({ game: 501, doubleIn: true, players: [{ name: 'Bot' }, { name: 'Passive' }] })
    const pro = BOT_ROSTER[5]
    expect(botDart(state, pro, () => 0)).toBe('D20')
    state.players[0].opened = true
    state.players[0].score = 40
    expect(botDart(state, pro, () => 0)).toBe('D20')
    state.players[0].score = 41
    state.currentVisit = evaluateOnlineEntry('MISS MISS', 0).hits
    expect(botDart(state, pro, () => 0)).toBe('9')
    state.players[0].score = 100
    expect(botDart(state, pro, () => 0)).toBe('T20')
    state.players[0].score = 17
    state.doubleOut = false
    expect(botDart(state, pro, () => 0)).toBe('17')
    state.winner = 0
    expect(botDart(state, pro)).toBe('MISS')
  })

  it('is deterministic, pure and physically legal even at RNG boundaries', () => {
    const state = createGameState({ players: [{ name: 'Bot' }, { name: 'Passive' }] })
    const before = JSON.stringify(state)
    const a = seeded(72), b = seeded(72)
    for (const bot of BOT_ROSTER) {
      for (let i = 0; i < 500; i++) expect(botDart(state, bot, a)).toBe(botDart(state, bot, b))
      for (const score of [2, 3, 25, 40, 50, 61, 99, 170, 501]) {
        const testState = { ...state, players: state.players.map((p) => ({ ...p, score })) }
        for (const value of [0, 0.1, 0.5, 0.9, 0.99, 1, NaN]) expect(botDart(testState, bot, () => value)).toMatch(legal)
      }
    }
    expect(JSON.stringify(state)).toBe(before)
  })

  it('every level finishes full legs against a passive opponent in all 16 formats', () => {
    for (const bot of BOT_ROSTER) for (const game of GAMES) for (const doubleIn of [false, true]) for (const doubleOut of [false, true]) {
      for (let seed = 1; seed <= 12; seed++) leg(bot, seed, game, doubleIn, doubleOut)
    }
  }, 30000)

  it('has calibrated, widely separated 501 double-out averages', () => {
    const averages = BOT_ROSTER.map((bot) => {
      let darts = 0
      for (let seed = 1; seed <= 300; seed++) darts += leg(bot, seed * 7919).players[0].darts
      return 501 * 3 * 300 / darts
    })
    console.info('Seeded 501 straight-in/double-out averages:', averages.map((average) => average.toFixed(1)).join(', '))
    averages.forEach((average, index) => {
      const [low, high] = BOT_ROSTER[index].average.split('–').map(Number)
      expect(average).toBeGreaterThanOrEqual(low)
      expect(average).toBeLessThanOrEqual(high)
      if (index) expect(average - averages[index - 1]).toBeGreaterThan(10)
    })
  }, 30000)
})
