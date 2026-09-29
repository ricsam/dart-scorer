import { expect, test, type Page } from '@playwright/test'

const scoreInput = (page: Page) => page.getByLabel('Enter dart hits')
const cards = (page: Page) => page.locator('.scoreboard .player-card')

async function enter(page: Page, value: string) {
  await scoreInput(page).fill(value)
  await scoreInput(page).press('Enter')
}

async function expectScores(page: Page, scores: number[]) {
  await expect(page.locator('.scoreboard .big-score')).toHaveText(scores.map(String))
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
})

test('scores visits, busts, rejects invalid darts, and completes a leg', async ({ page }) => {
  await expectScores(page, [101, 101])
  await expect(page.locator('.turn-context strong')).toHaveText('ALEX')

  await enter(page, 'T20 T20 T20')
  await expectScores(page, [101, 101])
  await expect(cards(page).nth(0).locator('.player-stats strong').nth(1)).toHaveText('2')
  await expect(page.locator('.visit-list .visit').first()).toContainText('BUST')
  await expect(page.locator('.visit-list .visit').first()).toContainText('T20 · T20 · 101 → 101')
  await expect(page.locator('.turn-context strong')).toHaveText('JAMIE')

  await enter(page, '20')
  await expectScores(page, [101, 81])
  await expect(page.locator('.dart-slots span').nth(0)).toHaveText('20')
  await enter(page, '20 20')
  await expectScores(page, [101, 41])
  await expect(cards(page).nth(1).locator('.player-stats strong').first()).toHaveText('60.0')

  await scoreInput(page).fill('T19 D22')
  await expect(page.locator('.entry-error')).toHaveText('“D22” is not a valid dart.')
  await scoreInput(page).press('Enter')
  await expectScores(page, [101, 41])

  await enter(page, 'T19 4 D20')
  await expect(page.locator('.winner-modal h2')).toHaveText('Alex wins!')
  await expect(page.locator('.winner-modal p')).toHaveText('Clean finish. Jamie starts the next leg.')
  await page.getByRole('button', { name: 'START NEXT LEG' }).click()

  await expectScores(page, [101, 101])
  await expect(cards(page).nth(0).locator('.legs strong')).toHaveText('1')
  await expect(page.locator('.turn-context strong')).toHaveText('JAMIE')
  await expect(page.locator('.leg-history button')).toHaveCount(1)
  await expect(page.locator('.leg-history button').first()).toContainText('LEG 1Alex')
  await expect(page.locator('.leg-history button').first()).toContainText('Alex 60.6')
  await expect(page.locator('.leg-history button').first()).toContainText('Jamie 60.0')
})

test('undo removes single darts and reopens completed visits', async ({ page }) => {
  await enter(page, 'T20')
  await expectScores(page, [41, 101])
  await page.getByRole('button', { name: 'Undo last dart or visit' }).click()
  await expectScores(page, [101, 101])
  await expect(page.locator('.dart-slots span').nth(0)).toHaveText('DART 1')

  await enter(page, '20 20 20')
  await expectScores(page, [41, 101])
  await expect(page.locator('.turn-context strong')).toHaveText('JAMIE')
  await page.getByRole('button', { name: 'Undo last dart or visit' }).click()
  await expect(page.locator('.turn-context strong')).toHaveText('ALEX')
  await expectScores(page, [61, 101])
  await expect(page.locator('.dart-slots span')).toHaveText(['20', '20', 'DART 3'])
  await enter(page, 'D20')
  await expectScores(page, [21, 101])
  await expect(page.locator('.visit-list .visit').first()).toContainText('20 · 20 · D20 · 101 → 21')
})

test('leg history rewinds to the start of a past visit', async ({ page }) => {
  await enter(page, '20 20 20')
  await enter(page, 'T20 T20 T20')
  await enter(page, '1 D20')
  await expect(page.locator('.winner-modal h2')).toHaveText('Alex wins!')
  await page.getByRole('button', { name: 'START NEXT LEG' }).click()
  await enter(page, 'T20')

  await page.getByRole('button', { name: 'View details for leg 1' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('h2')).toHaveText('Alex won')
  await expect(dialog.locator('.leg-player-summary').first()).toContainText('LEG WINNER')
  await expect(dialog.locator('.leg-player-summary').nth(1)).toContainText('101 LEFT')
  await dialog.getByRole('button', { name: 'Load visit 2 by Jamie' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('Return to visit 2?')
  await page.getByRole('alertdialog').getByRole('button', { name: 'LOAD VISIT' }).click()

  await expectScores(page, [41, 101])
  await expect(page.locator('.turn-context strong')).toHaveText('JAMIE')
  await expect(cards(page).nth(0).locator('.legs strong')).toHaveText('0')
  await expect(page.locator('.leg-history')).toHaveCount(0)
  await expect(page.locator('.visit-list .visit')).toHaveCount(1)
})

test('double-in ignores darts until a double opens scoring', async ({ page }) => {
  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.getByRole('group', { name: 'Starting rule' }).getByRole('button', { name: 'DOUBLE IN' }).click()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(cards(page).nth(0).locator('.turn-label')).toHaveText('DOUBLE REQUIRED TO START')

  await enter(page, '20 D10 20')
  await expectScores(page, [61, 101])
  await expect(page.locator('.visit-list .visit').first()).toContainText('(20) · D10 · 20 · 101 → 61')
  await expect(page.locator('footer')).toContainText('DOUBLE IN · DOUBLE OUT')
})

test('roster and format settings update the match', async ({ page }) => {
  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.getByRole('button', { name: 'ADD PLAYER' }).click()
  await expect(page.getByLabel('Player 3 name')).toHaveValue('Player 3')
  await page.getByLabel('Player 3 name').fill('Robin')
  await page.getByLabel('Game format').selectOption('301')
  await page.getByRole('button', { name: 'Close settings' }).click()

  await expect(page.locator('.scoreboard')).toHaveClass(/multi-player/)
  await expectScores(page, [301, 301, 301])
  await expect(page.locator('.player-settings-button span')).toHaveText('3')
  await enter(page, 'T20 T20 T20')
  await enter(page, '60 0 0')
  await expect(page.locator('.turn-context strong')).toHaveText('ROBIN')
  await expectScores(page, [121, 241, 301])

  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.getByRole('button', { name: 'Remove Jamie' }).click()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expectScores(page, [121, 301])
  await expect(page.locator('.turn-context strong')).toHaveText('ROBIN')

  await page.locator('.player-name').first().click()
  await page.locator('.name-modal input').fill('Sam')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.locator('.player-name').first()).toContainText('Sam')
})

test('reset clears the current leg after confirmation', async ({ page }) => {
  await enter(page, 'T20')
  await page.getByRole('button', { name: 'Restart leg' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('Reset the current leg?')
  await page.getByRole('button', { name: 'RESET LEG' }).click()
  await expectScores(page, [101, 101])
  await expect(page.locator('.dart-slots span').nth(0)).toHaveText('DART 1')
})
