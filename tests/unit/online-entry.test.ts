import { expect, it } from 'vitest'
import { evaluateEntry, evaluateOnlineEntry } from '../../src/game'

it('validates physical darts for recorded play but retains casual parsing', () => {
  for (const entry of ['501', '999', '41', '23', '61', '179', '99999999999999999999999']) {
    expect(evaluateOnlineEntry(entry, 0).error).toContain('not a possible single dart')
    expect(evaluateEntry(entry, 0).error).toBeNull()
  }
  for (const entry of ['36', '60', '50', '25', 'T20', 'D18', '0', '', '20 5 D18']) {
    expect(evaluateOnlineEntry(entry, 0).error).toBeNull()
  }
  expect(evaluateOnlineEntry('20 20', 2).error).toContain('Only 1 dart')
})
