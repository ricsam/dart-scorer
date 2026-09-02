import { expect, test, type Page } from '@playwright/test'

const scoreInput = (page: Page) => page.getByLabel('Enter dart hits')

async function layoutSnapshot(page: Page) {
  return page.evaluate(() => {
    const selectors = ['.topbar', '.scoreboard', '.scoring-zone', '.visit-progress', '.calc-display']
    return Object.fromEntries(selectors.map((selector) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect()
      return [selector, { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width }]
    }))
  })
}

for (const viewport of [
  { name: 'phone portrait', width: 390, height: 844 },
  { name: 'phone landscape', width: 844, height: 390 },
  { name: 'small landscape', width: 667, height: 375 },
]) {
  test(`${viewport.name} keeps scoring controls stable and visible`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')

    const beforeFocus = await layoutSnapshot(page)
    const shellClassBeforeFocus = await page.locator('.app-shell').getAttribute('class')
    await scoreInput(page).focus()
    const afterFocus = await layoutSnapshot(page)
    const shellClassAfterFocus = await page.locator('.app-shell').getAttribute('class')
    await scoreInput(page).blur()
    const afterBlur = await layoutSnapshot(page)
    const shellClassAfterBlur = await page.locator('.app-shell').getAttribute('class')

    expect(afterFocus).toEqual(beforeFocus)
    expect(afterBlur).toEqual(beforeFocus)
    expect(shellClassAfterFocus).toBe(shellClassBeforeFocus)
    expect(shellClassAfterBlur).toBe(shellClassBeforeFocus)

    const calcBox = await page.locator('.calc-display').boundingBox()
    expect(calcBox).not.toBeNull()
    expect(calcBox!.x).toBeGreaterThanOrEqual(0)
    expect(calcBox!.x + calcBox!.width).toBeLessThanOrEqual(viewport.width)
    expect(calcBox!.y + calcBox!.height).toBeLessThanOrEqual(viewport.height)
    if (viewport.width > viewport.height) {
      expect(calcBox!.y + calcBox!.height).toBeLessThanOrEqual(viewport.height * 0.55)
      const scoreboardBox = await page.locator('.scoreboard').boundingBox()
      expect(scoreboardBox).not.toBeNull()
      expect(calcBox!.x).toBeGreaterThan(scoreboardBox!.x + scoreboardBox!.width)
    }

    await expect(page.locator('.keypad')).toBeHidden()
    await expect(scoreInput(page)).toBeVisible()
  })
}

test('desktop retains the full keypad', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await expect(page.locator('.keypad')).toBeVisible()
})
