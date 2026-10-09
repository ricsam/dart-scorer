import { expect, test, type Page } from '@playwright/test'
import type { CareerStatsResponse, MatchDetail } from '../src/shared/api'

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(path, { data, headers: { origin: new URL(page.url()).origin } })
  expect(response.ok(), await response.text()).toBe(true)
  return response.json()
}

async function complete(page: Page, matchId: string, entries: string[]) {
  let { match } = await (await page.request.get(`/api/matches/${matchId}`)).json() as { match: MatchDetail }
  for (const entry of entries) {
    ;({ match } = await post(page, `/api/matches/${matchId}/actions`, { baseVersion: match.version, action: { type: 'submit', entry } }))
  }
  await post(page, `/api/matches/${matchId}/finish`, { baseVersion: match.version })
}

for (const width of [320, 1280]) {
  test(`selectable weighted progress charts and category histories work at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await page.getByLabel('Name', { exact: true }).fill('Progress player')
    await page.getByLabel('Email').fill(`progress-${width}-${Date.now()}@example.com`)
    await page.getByRole('button', { name: 'SIGN IN (DEV)' }).click()
    await expect(page.getByRole('heading', { name: 'Ready for the oche?' })).toBeVisible()
    const settings = { game: 101, doubleIn: false, doubleOut: true, legsToWin: 1 }
    const { lobby } = await post(page, '/api/lobbies', { settings })
    for (const entries of [['T20 9 D16'], ['T20 9 M', 'M M M', 'D16']]) {
      const { matchId } = await post(page, `/api/lobbies/${lobby.id}/start`)
      await complete(page, matchId, entries)
    }
    const { user } = await (await page.request.get('/api/me')).json()
    const { league } = await post(page, '/api/leagues', { name: 'Progress league' })
    const { match } = await post(page, `/api/leagues/${league.id}/matches`, { players: [{ guestName: 'Guest winner' }, { userId: user.id }], settings })
    await complete(page, match.id, ['T20 9 D16'])
    const data = await (await page.request.get('/api/me/stats')).json() as CareerStatsResponse
    expect(data.trend).toHaveLength(3)
    expect(data.all.history[0].checkoutRate).toBeCloseTo(2 / 6)
    expect(data.competitionTrend[0].checkoutRate).toBeNull()

    await page.goto('/me')
    const progress = page.getByRole('region', { name: 'Progress over time', exact: true })
    await progress.getByLabel('Statistic').selectOption('checkoutRate')
    await expect(progress.getByRole('heading', { name: 'Checkout rate per game', exact: true })).toBeVisible()
    await expect(progress.locator('.trend-summary')).toContainText('3-game rate 33.3%')
    await expect(progress.getByRole('region', { name: 'Monthly results table' })).toContainText('33.3% (2/6)')
    await expect(progress.getByRole('img', { name: /Checkout rate per game/ })).toBeVisible()
    await progress.getByText('View game results', { exact: true }).click()
    const games = progress.getByRole('region', { name: 'Game results table' })
    await expect(games.locator('tbody tr')).toHaveCount(3)
    await expect(games).toContainText('100.0% (1/1)')
    await expect(games).toContainText('20.0% (1/5)')
    await expect(games).toContainText('— (0/0)')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await progress.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`checkout-${width}.png`), fullPage: true })

    for (const [metric, title] of [['first9Average', 'First-nine average'], ['highestCheckout', 'Highest checkout'], ['bestLegDarts', 'Best leg'], ['scores180', '180s'], ['scores140', '140+ visits'], ['scores100', '100+ visits']]) {
      await progress.getByLabel('Statistic').selectOption(metric)
      await expect(progress.getByRole('heading', { name: `${title} per game`, exact: true })).toBeVisible()
      await expect(progress.locator('svg')).toHaveCount(2)
    }
    await progress.getByLabel('Statistic').selectOption('first9Average')
    await expect(progress.locator('.trend-summary')).toContainText('60.6')
    await page.getByRole('button', { name: 'Account menu for Progress player' }).click()
    await page.getByRole('menuitem', { name: 'Light theme' }).click()
    await progress.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`progress-light-${width}.png`), fullPage: true })

    await page.getByRole('group', { name: 'Stats category' }).getByRole('button', { name: 'Competition', exact: true }).click()
    await progress.getByLabel('Statistic').selectOption('checkoutRate')
    await expect(progress.locator('.trend-summary')).toContainText('Last 1 game · 1-game rate —')
    await expect(progress).toContainText('No checkout rate recorded in these games yet.')
    await expect(progress.locator('svg')).toHaveCount(0)
    await page.getByRole('group', { name: 'Stats category' }).getByRole('button', { name: 'Training', exact: true }).click()
    await progress.getByLabel('Statistic').selectOption('checkoutRate')
    await expect(progress.locator('.trend-summary')).toContainText('Last 2 games · 2-game rate 33.3%')
    await page.reload()
    await progress.getByLabel('Statistic').selectOption('checkoutRate')
    await expect(progress.locator('.trend-summary')).toContainText('Last 3 games')
  })
}
