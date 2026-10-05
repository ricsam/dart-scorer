import { expect, test } from '@playwright/test'

for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 740 }]) {
  test(`public scoring guide, formulas and anchors work at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/login')
    await page.getByRole('contentinfo').getByRole('link', { name: 'ABOUT & SCORING' }).click()
    await expect(page).toHaveURL(/\/about$/)
    await expect(page).toHaveTitle('About & scoring — Oche')
    await expect(page.getByRole('heading', { name: 'About & scoring', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'On this page' }).getByRole('link')).toHaveCount(6)

    for (const theme of ['dark', 'light']) {
      if (theme === 'light') {
        await page.getByRole('button', { name: 'Switch to light theme' }).click()
        await expect(page.locator('.online-shell')).toHaveClass(/light/)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`about-${theme}.png`) })
      await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'League ratings (Elo)' }).click()
      await expect(page).toHaveURL(/\/about#ratings$/)
      await expect(page.locator('#ratings')).toBeInViewport()
      await expect(page.getByLabel('Elo formulas')).toContainText('32 ÷ (n − 1)')
      await expect(page.getByText('1016 and 984', { exact: true })).toBeVisible()
      expect(await page.evaluate(() => [...document.querySelectorAll('.about-formula')].every((element) => element.scrollWidth <= element.clientWidth))).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`ratings-${theme}.png`) })
      await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Averages & statistics' }).click()
      await expect(page.locator('#statistics')).toBeInViewport()
      await expect(page.getByText('3 × 240 ÷ 15 = 48.0', { exact: true })).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
    }
    await page.goto('/about#statistics')
    await expect(page.locator('#statistics')).toBeInViewport()
    await page.reload()
    await expect(page.locator('#statistics')).toBeInViewport()
    await page.getByRole('contentinfo').getByRole('link', { name: 'PRIVACY' }).click()
    await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible()
  })
}

test('guide remains public if the session API fails', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({ status: 503, json: { error: { message: 'Unavailable' } } }))
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'About & scoring', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'On this page' })).toBeVisible()
  await expect(page).toHaveURL(/\/about$/)
})

for (const width of [320, 1280]) {
  test(`online quick game opens the guide without losing the current game at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 })
    await page.goto('/play')
    await page.getByLabel('Enter dart hits').fill('20')
    await page.getByLabel('Enter dart hits').press('Enter')
    await expect(page.locator('.scoreboard .big-score')).toHaveText(['81', '101'])
    if (width === 1280) await page.getByRole('button', { name: 'Open settings' }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const popup = page.waitForEvent('popup')
    await page.getByRole('link', { name: width === 1280 ? 'READ THE GUIDE (opens in a new tab)' : 'About & scoring (opens in a new tab)' }).click()
    const guide = await popup
    await expect(guide.getByRole('heading', { name: 'About & scoring', exact: true })).toBeVisible()
    await expect(guide).toHaveURL(/\/about$/)
    await guide.close()
    await expect(page.locator('.scoreboard .big-score')).toHaveText(['81', '101'])
  })
}

test('account menu, profile and leaderboard link to the guide', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Name').fill('Guide reader')
  await page.getByLabel('Email').fill(`guide-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'SIGN IN (DEV)' }).click()
  await page.getByRole('button', { name: 'Account menu for Guide reader' }).click()
  await page.getByRole('menuitem', { name: 'About & scoring' }).click()
  await expect(page.getByRole('heading', { name: 'About & scoring', exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'MY STATS' }).click()
  await page.getByRole('link', { name: 'How ratings & stats work' }).click()
  await expect(page).toHaveURL(/\/about$/)
  await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'LEAGUES' }).click()
  await page.getByRole('button', { name: 'NEW LEAGUE' }).click()
  await page.getByLabel('League name').fill('Guide league')
  await page.getByRole('button', { name: 'CREATE LEAGUE' }).click()
  await page.getByRole('link', { name: 'How ratings & stats work' }).click()
  await expect(page).toHaveURL(/\/about$/)
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Guide league' })).toBeVisible()
})

test('guests can use the guide from their mobile account menu', async ({ page }) => {
  // The guide needs no league data; isolate the guest navigation state.
  await page.route('**/api/me', (route) => route.fulfill({ json: {
    user: { id: 'guest-guide', name: 'Guest reader', guest: true, avatarUrl: null, email: null, createdAt: '2026-01-01T00:00:00.000Z' },
  } }))
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/privacy')
  await page.getByRole('button', { name: 'Account menu for Guest reader' }).click()
  await page.getByRole('menuitem', { name: 'About & scoring' }).click()
  await expect(page.getByRole('heading', { name: 'About & scoring', exact: true })).toBeVisible()
  await expect(page.locator('article')).toContainText('guests have no Elo rating')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
