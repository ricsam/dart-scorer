import { expect, test, type Browser, type Page } from '@playwright/test'
import type { LeagueDetail, MatchDetail, User } from '../src/shared/api'

async function setup(browser: Browser, baseURL: string, width = 1280) {
  const contexts = await Promise.all(['Host', 'Co-host candidate', 'Other player'].map(async (name) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 844 } })
    const login = await context.request.post('/auth/dev-login', { data: { name, email: `cohost-${name.replaceAll(' ', '-')}-${crypto.randomUUID()}@example.com` } })
    expect(login.ok()).toBe(true)
    const { user } = await login.json() as { user: User }
    return { context, user, page: await context.newPage() }
  }))
  const [host, candidate, other] = contexts
  const created = await host.context.request.post('/api/leagues', { data: { name: 'Shared hosting' } })
  expect(created.status()).toBe(201)
  const { league } = await created.json() as { league: LeagueDetail }
  for (const member of [candidate, other]) {
    expect((await member.context.request.post(`/api/invites/${league.inviteCode}/join`, { data: {} })).ok()).toBe(true)
  }
  const guest = await host.context.request.post(`/api/leagues/${league.id}/guests`, { data: { name: 'Guest player' } })
  expect(guest.status()).toBe(201)
  return { host, candidate, other, league, close: () => Promise.all(contexts.map(({ context }) => context.close())) }
}

async function members(page: Page, leagueId: string) {
  await page.goto(`/leagues/${leagueId}`)
  await page.getByRole('tab', { name: /MEMBERS/ }).click()
}

for (const width of [1280, 320]) {
  test(`hosts promote and revoke co-hosts across live devices at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const { host, candidate, other, league, close } = await setup(browser, baseURL!, width)
    try {
      await members(host.page, league.id)
      await members(candidate.page, league.id)
      await expect(candidate.page.getByRole('button', { name: /Make .* a co-host/ })).toHaveCount(0)
      await expect(host.page.getByRole('button', { name: 'Make Guest player a co-host' })).toHaveCount(0)
      await expect(host.page.getByRole('button', { name: 'Make Host a co-host', exact: true })).toHaveCount(0)
      const matchResponse = await host.context.request.post(`/api/leagues/${league.id}/matches`, {
        data: { players: [{ userId: host.user.id }, { guestName: 'Guest player' }], settings: { game: 101, doubleIn: false, doubleOut: true, legsToWin: 1 } },
      })
      expect(matchResponse.status()).toBe(201)
      const { match } = await matchResponse.json() as { match: MatchDetail }
      const spectator = await candidate.context.newPage()
      await spectator.goto(`/matches/${match.id}`)
      await expect(spectator.getByText('Watching live.')).toBeVisible()

      await host.page.getByRole('button', { name: 'Make Co-host candidate a co-host' }).click()
      let dialog = host.page.getByRole('dialog', { name: 'Make Co-host candidate a co-host?' })
      await expect(dialog).toContainText('Only the original host')
      await dialog.getByRole('button', { name: 'CANCEL' }).click()
      await expect(candidate.page.getByRole('button', { name: 'Rename league', exact: true })).toHaveCount(0)
      await host.page.getByRole('button', { name: 'Make Co-host candidate a co-host' }).click()
      await dialog.getByRole('button', { name: 'MAKE CO-HOST', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      const candidateRow = host.page.locator('.member-row').filter({ hasText: candidate.user.name })
      await expect(candidateRow.locator('.role-pill')).toHaveText('CO-HOST')
      await expect(candidate.page.getByText('YOU CO-HOST THIS LEAGUE')).toBeVisible()
      await expect(candidate.page.getByRole('button', { name: 'Rename league', exact: true })).toBeVisible()
      await expect(candidate.page.getByRole('button', { name: 'DELETE LEAGUE' })).toHaveCount(0)
      await expect(candidate.page.getByRole('button', { name: 'Remove Host from the league', exact: true })).toHaveCount(0)
      await expect(candidate.page.getByRole('button', { name: /Remove co-host role/ })).toHaveCount(0)
      await expect(spectator.getByLabel('Enter dart hits')).toBeVisible()
      await spectator.getByLabel('Enter dart hits').fill('20')
      await spectator.getByLabel('Enter dart hits').press('Enter')
      await expect(spectator.locator('.scoreboard .big-score').first()).toHaveText('81')

      // Co-hosts may appoint other account members, but cannot revoke their peers.
      await candidate.page.getByRole('button', { name: 'Make Other player a co-host' }).click()
      await candidate.page.getByRole('dialog').getByRole('button', { name: 'MAKE CO-HOST', exact: true }).click()
      await expect(host.page.locator('.member-row').filter({ hasText: other.user.name }).locator('.role-pill')).toHaveText('CO-HOST')
      await expect(candidate.page.getByRole('button', { name: 'Remove Other player from the league' })).toHaveCount(0)
      await expect(candidate.page.getByRole('button', { name: 'Remove co-host role from Other player' })).toHaveCount(0)
      await candidate.page.getByRole('button', { name: 'INVITE', exact: true }).click()
      await expect(candidate.page.getByRole('button', { name: 'RESET LINK' })).toBeVisible()
      await candidate.page.getByRole('button', { name: 'Close' }).click()
      await candidate.page.reload()
      await candidate.page.getByRole('tab', { name: /MEMBERS/ }).click()
      await expect(candidate.page.getByText('YOU CO-HOST THIS LEAGUE')).toBeVisible()
      for (const theme of ['dark', 'light']) {
        if (theme === 'light') {
          await host.page.getByRole('button', { name: 'Account menu for Host' }).click()
          await host.page.getByRole('menuitem', { name: 'Light theme' }).click()
          await host.page.keyboard.press('Escape')
        }
        await expect(candidateRow.locator('.role-pill')).toBeVisible()
        const ratings = await host.page.locator('.member-rating').all()
        const ratingColumn = (await ratings[0].boundingBox())!
        for (const rating of ratings.slice(1)) expect((await rating.boundingBox())!.x).toBeCloseTo(ratingColumn.x, 1)
        expect(await host.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await host.page.getByRole('region', { name: 'Members', exact: true }).screenshot({ path: testInfo.outputPath(`cohosts-${width}-${theme}.png`) })
      }

      await host.page.getByRole('button', { name: 'Remove co-host role from Co-host candidate' }).click()
      dialog = host.page.getByRole('dialog', { name: 'Remove Co-host candidate as co-host?' })
      await expect(dialog).toContainText('stay in the league as a member')
      await dialog.getByRole('button', { name: 'REMOVE CO-HOST', exact: true }).click()
      await expect(candidateRow.locator('.role-pill')).toHaveCount(0)
      await expect(candidate.page.getByRole('button', { name: 'Rename league', exact: true })).toHaveCount(0)
      await expect(spectator.getByText('Watching live.')).toBeVisible()
      await expect(spectator.getByLabel('Enter dart hits')).toHaveCount(0)
      await expect(spectator.locator('.scoreboard .big-score').first()).toHaveText('81')
      await expect(candidate.page.locator('.member-row').filter({ hasText: candidate.user.name })).toBeVisible()
      await other.page.goto('/leagues')
      await expect(other.page.getByText('You co-host this league')).toBeVisible()
    } finally {
      await close()
    }
  })
}

test('co-host changes handle pending and failed saves without falsely granting access', async ({ browser, baseURL }) => {
  const { host, candidate, league, close } = await setup(browser, baseURL!)
  try {
    await members(host.page, league.id)
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const endpoint = `**/api/leagues/${league.id}/members/${candidate.user.id}`
    await host.page.route(endpoint, async (route) => {
      await pending
      await route.fulfill({ status: 403, json: { error: 'forbidden', message: 'Only league hosts can do that.' } })
    })
    await host.page.getByRole('button', { name: 'Make Co-host candidate a co-host' }).click()
    const dialog = host.page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'MAKE CO-HOST', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'SAVING…' })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'CANCEL' })).toBeDisabled()
    release()
    await expect(dialog.getByRole('alert')).toHaveText('Only league hosts can do that.')
    await expect(host.page.locator('.member-row').filter({ hasText: candidate.user.name }).locator('.role-pill')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'CANCEL' }).click()
    await host.page.unroute(endpoint)
    await host.page.getByRole('button', { name: 'Make Co-host candidate a co-host' }).click()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'MAKE CO-HOST', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(host.page.locator('.member-row').filter({ hasText: candidate.user.name }).locator('.role-pill')).toHaveText('CO-HOST')
  } finally {
    await close()
  }
})
