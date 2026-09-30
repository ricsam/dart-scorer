import { expect, test, type Browser, type Page } from '@playwright/test'

async function newUser(browser: Browser) {
  const context = await browser.newContext()
  return context.newPage()
}

async function devSignIn(page: Page, name: string, email: string) {
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'SIGN IN (DEV)' }).click()
}

async function enter(page: Page, darts: string) {
  const input = page.getByLabel('Enter dart hits')
  await input.fill(darts)
  await input.press('Enter')
}

test('signed-out visitors get the standalone scorer with a way to sign in', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Enter dart hits')).toBeVisible()
  await expect(page.locator('.scoreboard .big-score')).toHaveText(['101', '101'])
  await page.getByRole('link', { name: 'Sign in for rooms and leaderboards' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Your darts crew, one oche.' })).toBeVisible()
  await expect(page.getByText('DEVELOPMENT SIGN-IN')).toBeVisible()

  await page.goto('/rooms/does-not-exist')
  await expect(page).toHaveURL(/\/login\?returnTo=%2Frooms%2Fdoes-not-exist$/)
})

test('rooms, invites, a live match across two devices, and the leaderboard', async ({ browser }, testInfo) => {
  const run = Date.now().toString(36)
  const alice = await newUser(browser)
  const bob = await newUser(browser)

  // Alice signs in and creates a room.
  await alice.goto('/login')
  await devSignIn(alice, 'Alice', `alice-${run}@example.com`)
  await expect(alice.getByRole('heading', { name: 'Alice' })).toBeVisible()
  await alice.getByRole('button', { name: 'NEW ROOM' }).click()
  await alice.getByLabel('Room name').fill('Friday Oche Club')
  await alice.getByRole('button', { name: 'CREATE ROOM' }).click()
  await expect(alice.getByRole('heading', { name: 'Friday Oche Club' })).toBeVisible()
  await expect(alice.locator('.room-meta')).toContainText('1 member')

  // Alice shares the invite link.
  await alice.getByRole('button', { name: 'INVITE', exact: true }).click()
  const inviteLink = await alice.getByLabel('Invite link').inputValue()
  expect(inviteLink).toMatch(/^http:\/\/127\.0\.0\.1:4180\/join\/[A-Za-z0-9_-]+$/)
  await expect(alice.getByRole('img', { name: /QR code/ })).toBeVisible()
  await alice.getByRole('button', { name: 'Close' }).click()

  // Bob opens the invite signed out, signs in and joins.
  await bob.goto(inviteLink)
  await expect(bob.getByRole('heading', { name: 'Friday Oche Club' })).toBeVisible()
  await expect(bob.getByText('Hosted by')).toContainText('Alice')
  await bob.getByRole('link', { name: 'SIGN IN TO JOIN' }).click()
  await devSignIn(bob, 'Bob', `bob-${run}@example.com`)
  await bob.getByRole('button', { name: 'JOIN ROOM' }).click()
  await expect(bob.getByRole('heading', { name: 'Friday Oche Club' })).toBeVisible()

  // Alice's room page updates live.
  await expect(alice.locator('.room-meta')).toContainText('2 members')
  const newBob = alice.locator('.leaderboard-table tbody tr').filter({ hasText: 'Bob' })
  await expect(newBob).toContainText('No matches yet')
  await expect(newBob.locator('td')).toHaveCount(11)
  await expect(newBob.locator('td').nth(2)).toHaveText('1000')
  await expect(newBob.locator('td').nth(2)).toHaveCSS('font-size', '16px')
  await expect(newBob.locator('td').nth(2)).toHaveCSS('text-align', 'right')

  // Alice starts a first-to-one 101 match against Bob.
  await alice.getByRole('button', { name: 'NEW MATCH' }).click()
  await alice.locator('.member-picker').getByRole('button', { name: 'Bob' }).click()
  await alice.getByRole('group', { name: 'Game' }).getByRole('button', { name: '101' }).click()
  for (let legs = 3; legs > 1; legs--) await alice.getByRole('button', { name: 'Fewer legs' }).click()
  await expect(alice.locator('.sheet-summary')).toHaveText('2 players · 101 · first to 1')
  await alice.getByRole('button', { name: 'START MATCH' }).click()
  await expect(alice).toHaveURL(/\/matches\/[A-Za-z0-9_-]+$/)
  const matchUrl = alice.url()

  // Bob sees the live match in the room and opens it on his own phone.
  await expect(bob.locator('.live-card')).toBeVisible()
  await bob.locator('.live-card').click()
  await expect(bob).toHaveURL(matchUrl)
  await expect(bob.locator('.turn-context strong')).toHaveText('ALICE')

  // Darts entered on one device appear on the other.
  await enter(alice, '20 20 20')
  await expect(bob.locator('.scoreboard .big-score')).toHaveText(['41', '101'])
  await expect(bob.locator('.turn-context strong')).toHaveText('BOB')
  await enter(bob, 'T20 T20 T20')
  await expect(alice.locator('.visit-list .visit').first()).toContainText('BUST')
  await expect(alice.locator('.turn-context strong')).toHaveText('ALICE')

  // Alice checks out; both devices see the result and Alice saves it.
  await enter(alice, '1 D20')
  await expect(alice.getByText('MATCH COMPLETE')).toBeVisible()
  await expect(bob.getByText('MATCH COMPLETE')).toBeVisible()
  await alice.getByRole('button', { name: 'SAVE RESULT' }).click()
  await expect(alice.getByRole('heading', { name: 'Alice won 1–0' })).toBeVisible()
  await expect(bob.getByRole('heading', { name: 'Alice won 1–0' })).toBeVisible()
  await expect(alice.locator('.stats-table')).toContainText('1016 (+16)')

  // The room leaderboard reflects the result.
  await alice.getByRole('link', { name: 'ROOM', exact: true }).click()
  const rows = alice.locator('.leaderboard-table tbody tr')
  await expect(rows.nth(0)).toContainText('Alice')
  await expect(rows.nth(0)).toContainText('1016')
  await expect(rows.nth(1)).toContainText('Bob')
  await expect(rows.nth(1)).toContainText('984')
  await rows.nth(0).click()
  await expect(alice.getByRole('dialog')).toContainText('HEAD TO HEAD')
  await expect(alice.getByRole('dialog').locator('.h2h-row')).toContainText('1–0')
  await alice.getByRole('button', { name: 'Close' }).click()

  // Someone outside the room cannot see the match.
  const carol = await newUser(browser)
  await carol.goto(matchUrl)
  await devSignIn(carol, 'Carol', `carol-${run}@example.com`)
  await expect(carol.getByText('doesn’t exist, was deleted, or belongs to a room you are not a member of')).toBeVisible()

  // A new member's rating uses the same column and typography as ranked players.
  await carol.goto(inviteLink)
  await carol.getByRole('button', { name: 'JOIN ROOM' }).click()
  const newCarol = rows.filter({ hasText: 'Carol' })
  await expect(newCarol).toContainText('No matches yet')
  await expect(newCarol.locator('td')).toHaveText(['–', /CarolNo matches yet$/, '1000', ...Array<string>(8).fill('—')])
  await expect(newCarol.locator('.delta')).toHaveCount(0)
  const newRating = newCarol.locator('td').nth(2)
  const rankedRating = rows.nth(0).locator('td').nth(2)
  for (const width of [1280, 390]) {
    await alice.setViewportSize({ width, height: 844 })
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') {
        await alice.getByRole('button', { name: 'Account menu for Alice' }).click()
        await alice.getByRole('menuitem', { name: 'Light theme' }).click()
        await alice.keyboard.press('Escape')
      }
      await expect(newRating).toHaveClass('sorted')
      for (const property of ['font-family', 'font-size', 'font-weight', 'text-align', 'color']) {
        await expect(newRating).toHaveCSS(property, await rankedRating.evaluate((cell, key) => getComputedStyle(cell).getPropertyValue(key), property))
      }
      const newBox = await newRating.boundingBox()
      const rankedBox = await rankedRating.boundingBox()
      expect(newBox).not.toBeNull()
      expect(rankedBox).not.toBeNull()
      expect(newBox!.x).toBeCloseTo(rankedBox!.x, 1)
      expect(newBox!.width).toBeCloseTo(rankedBox!.width, 1)
      expect(await alice.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await alice.locator('.leaderboard-panel').screenshot({ path: testInfo.outputPath(`new-player-${width}-${theme}.png`) })
    }
    await alice.getByRole('button', { name: 'Account menu for Alice' }).click()
    await alice.getByRole('menuitem', { name: 'Dark theme' }).click()
    await alice.keyboard.press('Escape')
  }
  await alice.setViewportSize({ width: 1280, height: 800 })
  await alice.getByLabel('SORT BY').selectOption('average')
  await expect(newRating).not.toHaveClass('sorted')
  await expect(newRating).toHaveText('1000')
  await expect(newCarol.locator('td.sorted')).toHaveText('—')
  await expect(newRating).toHaveCSS('text-align', 'right')

  // Bodyless mutations work end to end and stale pages lose access.
  await alice.getByRole('button', { name: 'INVITE', exact: true }).click()
  await alice.getByRole('button', { name: 'RESET LINK' }).click()
  await expect(alice.getByLabel('Invite link')).not.toHaveValue(inviteLink)
  await alice.getByRole('button', { name: 'Close' }).click()
  await alice.getByRole('tab', { name: /MEMBERS/ }).click()
  await alice.getByRole('button', { name: 'DELETE ROOM', exact: true }).click()
  await alice.getByRole('alertdialog').getByRole('button', { name: 'DELETE ROOM' }).click()
  await expect(alice.getByText('No rooms yet')).toBeVisible()
  await expect(bob.getByText('doesn’t exist, was deleted, or belongs to a room you are not a member of')).toBeVisible()
  await alice.getByRole('button', { name: 'Account menu for Alice' }).click()
  await alice.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(alice.getByLabel('Enter dart hits')).toBeVisible()
  await alice.reload()
  await expect(alice.getByRole('link', { name: 'Sign in for rooms and leaderboards' })).toBeVisible()
  await Promise.all([alice, bob, carol].map((p) => p.context().close()))
})

for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 740 }]) {
  test(`dart nicknames can be edited and persist at ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const email = `nickname-${viewport.width}-${Date.now()}@example.com`
    await page.goto('/login')
    await devSignIn(page, 'Alice', email)
    await page.getByRole('button', { name: 'NEW ROOM' }).click()
    await page.getByLabel('Room name').fill('Nickname club')
    await page.getByRole('button', { name: 'CREATE ROOM' }).click()
    await expect(page.getByRole('heading', { name: 'Nickname club' })).toBeVisible()
    const roomUrl = page.url()

    await page.getByRole('button', { name: 'Account menu for Alice' }).click()
    await page.getByRole('menuitem', { name: 'Edit dart nickname' }).click()
    await expect(page).toHaveURL(/\/me$/)
    const nickname = page.getByRole('textbox', { name: 'Dart nickname' })
    const save = page.getByRole('button', { name: 'SAVE NICKNAME' })
    const cancel = page.getByRole('button', { name: 'CANCEL', exact: true })
    await expect(nickname).toHaveValue('Alice')
    await expect(nickname).toHaveAttribute('maxlength', '24')
    await expect(save).toBeDisabled()
    await nickname.fill('   ')
    await expect(save).toBeDisabled()
    await nickname.fill('Unsaved nickname')
    await cancel.click()
    await expect(nickname).toHaveValue('Alice')
    await expect(save).toBeDisabled()

    await nickname.fill('  The Power 🎯  ')
    await save.click()
    await expect(page.getByRole('status')).toHaveText('Dart nickname saved.')
    await expect(page.getByRole('heading', { name: 'The Power 🎯', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Account menu for The Power 🎯' })).toBeVisible()
    await expect(nickname).toHaveValue('The Power 🎯')
    await expect(save).toBeDisabled()
    await page.reload()
    await expect(nickname).toHaveValue('The Power 🎯')

    // Maximum-length names and the editor fit even on narrow phones, in both themes.
    await nickname.fill('W'.repeat(24))
    await save.click()
    await expect(page.getByRole('status')).toHaveText('Dart nickname saved.')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('nickname-dark.png'), fullPage: true })
    await page.getByRole('button', { name: `Account menu for ${'W'.repeat(24)}` }).click()
    await page.getByRole('menuitem', { name: 'Light theme' }).click()
    await page.getByRole('menuitem', { name: 'Edit dart nickname' }).click()
    await expect(nickname).toHaveValue('W'.repeat(24))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('nickname-light.png'), fullPage: true })
    await nickname.fill('The Power 🎯')
    await nickname.press('Enter')
    await expect(page.getByRole('status')).toHaveText('Dart nickname saved.')

    // The same saved name appears in room membership, leaderboards and new matches.
    await page.goto(roomUrl)
    await expect(page.locator('.leaderboard-table')).toContainText('The Power 🎯')
    await page.getByRole('tab', { name: /MEMBERS/ }).click()
    await expect(page.locator('.member-list')).toContainText('The Power 🎯')
    await page.getByRole('button', { name: 'NEW MATCH' }).click()
    await expect(page.locator('.throw-order')).toContainText('The Power 🎯')
    await page.getByRole('dialog', { name: 'New match' }).getByLabel('Guest name').fill('Guest')
    await page.getByRole('dialog', { name: 'New match' }).getByRole('button', { name: 'ADD GUEST' }).click()
    await page.getByRole('button', { name: 'START MATCH' }).click()
    await expect(page.locator('.scoreboard .player-name').first()).toContainText('The Power 🎯')
    await page.goto('/me')
    await page.getByRole('button', { name: 'SIGN OUT', exact: true }).click()
    await expect(page.getByLabel('Enter dart hits')).toBeVisible()
    await page.goto('/login')
    await devSignIn(page, 'Alice', email)
    await expect(page.getByRole('heading', { name: 'The Power 🎯', exact: true })).toBeVisible()
  })
}

test('nickname saves show pending and failure states without losing the saved name', async ({ page }) => {
  await page.goto('/login?returnTo=%2Fme')
  await devSignIn(page, 'Alice', `nickname-errors-${Date.now()}@example.com`)
  const nickname = page.getByRole('textbox', { name: 'Dart nickname' })
  await expect(nickname).toHaveValue('Alice')
  await nickname.fill('The Power')
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/me', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    await pending
    await route.fulfill({ status: 500, json: { error: 'server_error', message: 'Could not save your nickname.' } })
  })
  await page.getByRole('button', { name: 'SAVE NICKNAME' }).click()
  await expect(page.getByRole('button', { name: 'SAVING…' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'CANCEL', exact: true })).toBeDisabled()
  await expect(nickname).toBeDisabled()
  release()
  await expect(page.getByRole('alert')).toHaveText('Could not save your nickname.')
  await expect(page.getByRole('heading', { name: 'Alice', exact: true })).toBeVisible()
  await expect(nickname).toHaveValue('The Power')
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.getByRole('button', { name: 'CANCEL', exact: true }).click()
  await expect(nickname).toHaveValue('Alice')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.unroute('**/api/me')
  await nickname.fill('The Power')
  await page.getByRole('button', { name: 'SAVE NICKNAME' }).click()
  await expect(page.getByRole('status')).toHaveText('Dart nickname saved.')
})

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`online room and scoring are usable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/login')
    await devSignIn(page, 'Mobile player', `mobile-${viewport.width}-${Date.now()}@example.com`)
    await page.getByRole('button', { name: 'NEW ROOM' }).click()
    await page.getByLabel('Room name').fill('Mobile club')
    await page.getByRole('button', { name: 'CREATE ROOM' }).click()
    await expect(page.getByRole('heading', { name: 'Mobile club' })).toBeVisible()
    await expect(page.locator('.user-menu-button .avatar')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'NEW MATCH' }).click()
    await page.getByLabel('Guest name').fill('Guest')
    await page.getByRole('button', { name: 'ADD GUEST' }).click()
    await page.getByRole('button', { name: 'START MATCH' }).click()
    await expect(page.getByLabel('Enter dart hits')).toBeVisible()
    await enter(page, '999')
    await expect(page.locator('.entry-error')).toContainText('not a possible single dart')
    await enter(page, 'T20')
    await expect(page.locator('.scoreboard .big-score').first()).toHaveText('441')
    await page.reload()
    await expect(page.locator('.scoreboard .big-score').first()).toHaveText('441')
    await page.getByRole('button', { name: 'Match statistics' }).click()
    await page.getByRole('button', { name: 'ABANDON MATCH' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'ABANDON', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Mobile club' })).toBeVisible()
    await expect(page.locator('.live-card')).toHaveCount(0)
  })
}

for (const width of [1280, 320]) {
  test(`invite guests share the roster and can claim a live player at width ${width}`, async ({ browser }, testInfo) => {
    const host = await newUser(browser)
    const alex = await newUser(browser)
    const sam = await newUser(browser)
    await alex.setViewportSize({ width, height: 800 })
    await sam.setViewportSize({ width, height: 800 })
    try {
      await host.goto('/login')
      await devSignIn(host, 'Host', `guest-host-${width}-${Date.now()}@example.com`)
      await host.getByRole('button', { name: 'NEW ROOM' }).click()
      await host.getByLabel('Room name').fill('Guest club')
      await host.getByRole('button', { name: 'CREATE ROOM' }).click()
      await expect(host.getByRole('heading', { name: 'Guest club' })).toBeVisible()
      const roomUrl = host.url()
      await host.getByRole('button', { name: 'INVITE', exact: true }).click()
      const invite = await host.getByLabel('Invite link').inputValue()
      await host.getByRole('button', { name: 'Close' }).click()

      // A shared-device guest is a persistent room player even before a match starts.
      await host.getByRole('tab', { name: /MEMBERS/ }).click()
      await host.getByLabel('Guest name').fill('Alex')
      await host.getByRole('button', { name: 'ADD GUEST' }).click()
      await expect(host.locator('.member-row').filter({ hasText: 'Alex' })).toContainText('Shared-device player')
      await host.getByRole('button', { name: 'NEW MATCH' }).click()
      await host.locator('.member-picker').getByRole('button', { name: /Alex/ }).click()
      await host.getByRole('group', { name: 'Game', exact: true }).getByRole('button', { name: '101' }).click()
      for (let legs = 3; legs > 1; legs--) await host.getByRole('button', { name: 'Fewer legs' }).click()
      await host.getByRole('button', { name: 'START MATCH' }).click()
      await expect(host).toHaveURL(/\/matches\//)
      const matchUrl = host.url()

      // Alex connects to that exact player after the match is already live.
      await alex.goto(invite)
      await alex.getByLabel('Existing guest').selectOption({ label: 'Alex' })
      await expect(alex.getByText('existing guest slot', { exact: false })).toBeVisible()
      expect(await alex.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await alex.screenshot({ path: testInfo.outputPath('guest-invite.png'), fullPage: true })
      await alex.getByRole('button', { name: 'JOIN AS A GUEST' }).click()
      await expect(alex).toHaveURL(roomUrl)
      await alex.getByRole('tab', { name: /MEMBERS/ }).click()
      await expect(alex.locator('.member-row').filter({ hasText: 'Alex' })).toHaveCount(1)
      await expect(alex.locator('.member-row').filter({ hasText: 'Alex' })).toContainText('Connected to a device')
      await alex.reload()
      await expect(alex.getByRole('button', { name: 'Account menu for Alex' })).toBeVisible()
      await expect(alex.getByRole('link', { name: 'MY STATS' })).toHaveCount(0)
      await alex.locator('.live-card').click()
      await expect(alex).toHaveURL(matchUrl)
      await expect(alex.getByLabel('Enter dart hits')).toBeVisible()

      // A second invite guest joins the same room, but is only a spectator in this match.
      await sam.goto(invite)
      await expect(sam.getByLabel('Existing guest')).toHaveCount(0)
      await sam.getByLabel('Your name').fill('Sam')
      await sam.getByRole('button', { name: 'JOIN AS A GUEST' }).click()
      await expect(sam).toHaveURL(roomUrl)
      await sam.locator('.live-card').click()
      await expect(sam.getByLabel('Enter dart hits')).toHaveCount(0)
      await enter(host, '20 20 20')
      await expect(alex.locator('.scoreboard .big-score')).toHaveText(['41', '101'])
      await enter(alex, 'T20 T20 T20')
      await expect(host.locator('.turn-context strong')).toHaveText('HOST')
      await enter(host, '1 D20')
      await alex.getByRole('button', { name: 'SAVE RESULT' }).click()
      await expect(alex.getByRole('heading', { name: 'Host won 1–0' })).toBeVisible()
      await alex.getByRole('link', { name: 'ROOM', exact: true }).click()
      await expect(alex.locator('.leaderboard-table tbody tr')).toHaveCount(1)
      await expect(alex.locator('.leaderboard-table')).not.toContainText('Alex')
      await expect(alex.locator('.leaderboard-table')).not.toContainText('Sam')

      // Rematches retain the guest identity and its scoring rights.
      await alex.goto(matchUrl)
      await alex.getByRole('button', { name: 'REMATCH' }).click()
      await expect(alex.getByLabel('Enter dart hits')).toBeVisible()
      await expect(alex.locator('.turn-context strong')).toHaveText('ALEX')
      await alex.goto('/')
      await expect(alex.getByText('PLAYING AS A GUEST')).toBeVisible()
      await expect(alex.getByRole('button', { name: 'NEW ROOM' })).toHaveCount(0)
      await expect(alex.getByText('Unranked', { exact: true })).toBeVisible()
      expect(await alex.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await alex.screenshot({ path: testInfo.outputPath('guest-home.png'), fullPage: true })
      await alex.getByRole('button', { name: 'Account menu for Alex' }).click()
      await expect(alex.getByRole('menuitem', { name: 'Edit dart nickname' })).toHaveCount(0)
      await alex.getByRole('menuitem', { name: 'End guest session' }).click()
      await alex.getByRole('button', { name: 'END SESSION', exact: true }).click()
      await alex.goto(invite)
      await alex.getByLabel('Your name').fill('Alex')
      await alex.getByRole('button', { name: 'JOIN AS A GUEST' }).click()
      await expect(alex.getByRole('alert')).toBeVisible()
      await expect(alex).toHaveURL(invite)
    } finally {
      await Promise.all([host, alex, sam].map((page) => page.context().close()))
    }
  })
}
