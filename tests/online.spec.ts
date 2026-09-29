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

test('rooms, invites, a live match across two devices, and the leaderboard', async ({ browser }) => {
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
