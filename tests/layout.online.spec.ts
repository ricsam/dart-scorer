import { expect, test } from '@playwright/test'

// Exercise space-consuming scrollbars rather than Chromium's hidden headless scrollbars.
test.use({
  viewport: { width: 1280, height: 1200 },
  launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
})

test('online layout stays aligned when the page scrollbar appears and disappears', async ({ page }) => {
  const layout = async () => {
    await page.evaluate(() => document.fonts.ready)
    return page.evaluate(() => ({
      scrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      boxes: ['.online-topbar', '.brand-link', '.online-main'].map((selector) => {
        const { x, width } = document.querySelector(selector)!.getBoundingClientRect()
        return { x, width }
      }),
    }))
  }

  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'SIGN IN (DEV)' })).toBeVisible()
  const shortPage = await layout()
  expect(shortPage.scrolls).toBe(false)

  await page.getByRole('contentinfo').getByRole('link', { name: 'ABOUT & SCORING' }).click()
  await expect(page.getByRole('heading', { name: 'About & scoring', exact: true })).toBeVisible()
  const longPage = await layout()
  expect(longPage.scrolls).toBe(true)
  expect(longPage.boxes).toEqual(shortPage.boxes)

  await page.goBack()
  await expect(page.getByRole('button', { name: 'SIGN IN (DEV)' })).toBeVisible()
  const shortPageAgain = await layout()
  expect(shortPageAgain.scrolls).toBe(false)
  expect(shortPageAgain.boxes).toEqual(shortPage.boxes)
  await expect(page.locator('html')).toHaveCSS('scrollbar-gutter', 'stable')
})
