import { expect, test, type Browser, type Page } from '@playwright/test'

async function signIn(browser: Browser, name: string, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(`${name.toLowerCase().replace(/\W/g, '')}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`)
  await page.getByRole('button', { name: 'SIGN IN (DEV)' }).click()
  await expect(page.getByRole('heading', { name: 'Ready for the oche?' })).toBeVisible()
  return page
}

async function enter(page: Page, darts: string) {
  const input = page.getByLabel('Enter dart hits')
  await input.fill(darts)
  await input.press('Enter')
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test('Play starts a solo practice game in your own lobby and tracks it as training', async ({ browser }, info) => {
  const page = await signIn(browser, 'Solo')
  await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'PLAY' }).click()
  await expect(page).toHaveURL(/\/lobbies\/[\w-]+$/)
  await expect(page.getByRole('heading', { name: 'Your lobby' })).toBeVisible()
  await expect(page.locator('.seat:not(.open-seat)')).toHaveCount(1)

  // The leader configures the format; it is remembered for the next lobby.
  await page.getByRole('group', { name: 'Game' }).getByRole('button', { name: '101' }).click()
  await expect(page.locator('.lobby-format')).toContainText('101')
  for (let legs = 3; legs > 1; legs--) await page.getByRole('button', { name: 'Fewer legs' }).click()
  await expect(page.locator('.lobby-format')).toContainText('FIRST TO 1')
  await expect(page.locator('.chat-system')).toContainText(['Solo set the game to 101'])
  await page.screenshot({ path: info.outputPath('solo-lobby.png'), fullPage: true })

  await page.getByRole('button', { name: 'START SOLO GAME' }).click()
  await expect(page).toHaveURL(/\/matches\/[\w-]+$/)
  await expect(page.locator('.scoreboard.solo .big-score')).toHaveText('101')
  await expect(page.getByText('SOLO PRACTICE · Saved to your training stats')).toBeVisible()
  await enter(page, 'T20 9 D16')
  await expect(page.getByText('PRACTICE COMPLETE')).toBeVisible()
  await expect(page.getByText(/Saved automatically in \d:\d\d/)).toBeVisible()
  await page.getByRole('button', { name: 'SAVE RESULT' }).click()
  await expect(page.getByRole('heading', { name: 'Practice: 101.0 average' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'PLAY AGAIN' })).toBeVisible()

  await page.goto('/me')
  await expect(page.getByRole('region', { name: 'All games' }).locator('.stat-tile').first()).toContainText('1')
  await page.getByRole('group', { name: 'Stats category' }).getByRole('button', { name: 'Competition', exact: true }).click()
  await expect(page.getByText('No completed matches yet', { exact: true })).toBeVisible()
  await page.getByRole('group', { name: 'Stats category' }).getByRole('button', { name: 'Training', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Training stats' }).locator('.match-row')).toContainText('SOLO · TRAINING')

  // Play again from the same lobby with the remembered format.
  await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'PLAY' }).click()
  await expect(page.locator('.lobby-format')).toContainText('101')
  await expect(page.locator('.lobby-page')).toContainText('Last game')
})

test('two players meet in a private ranked lobby, chat, score their own darts and move up the rankings', async ({ browser }, info) => {
  const alice = await signIn(browser, 'Alice')
  const bob = await signIn(browser, 'Bob', { width: 390, height: 844 })

  await alice.goto('/play')
  await expect(alice.getByRole('heading', { name: 'Your lobby' })).toBeVisible()
  await alice.getByRole('group', { name: 'Game' }).getByRole('button', { name: '101' }).click()
  for (let legs = 3; legs > 1; legs--) await alice.getByRole('button', { name: 'Fewer legs' }).click()
  await alice.getByRole('group', { name: 'Ranked play' }).getByRole('button', { name: 'RANKED', exact: true }).click()
  await expect(alice.locator('.eyebrow').first()).toContainText('RANKED')
  await expect(alice.getByRole('button', { name: 'START RANKED GAME' })).toBeDisabled()
  await expect(alice.locator('.lobby-start')).toContainText('Ranked games need at least two players.')

  // Alice shares the private invite link; Bob joins from his phone.
  await alice.getByRole('button', { name: 'INVITE', exact: true }).click()
  const link = await alice.getByLabel('Lobby invite link').inputValue()
  expect(link).toMatch(/\/lobbies\/[\w-]+\?code=[A-Z0-9]{10}$/)
  await alice.getByRole('button', { name: 'Close' }).click()
  await bob.goto(link)
  await expect(bob.getByRole('heading', { name: 'Alice’s lobby' })).toBeVisible()
  await bob.getByRole('button', { name: 'JOIN LOBBY' }).click()
  await expect(bob.getByRole('heading', { name: 'Alice’s lobby' })).toBeVisible()
  await expect(bob.getByText('Waiting for Alice')).toBeVisible()
  await expect(alice.locator('.seat:not(.open-seat)')).toHaveCount(2)
  await expect(alice.locator('.chat-system').last()).toHaveText('Bob joined the lobby.')
  expect(await noHorizontalScroll(bob)).toBe(true)

  // Lobby chat in both directions.
  await bob.getByLabel('Chat message').fill('Ready when you are')
  await bob.getByRole('button', { name: 'Send message' }).click()
  await expect(alice.locator('.chat-message').last()).toContainText('Ready when you are')
  await alice.locator('.chat-quick').getByRole('button', { name: 'Game on! 🎯' }).click()
  await expect(bob.locator('.chat-message').last()).toContainText('Game on! 🎯')
  await bob.screenshot({ path: info.outputPath('lobby-mobile.png'), fullPage: true })
  await alice.screenshot({ path: info.outputPath('lobby-desktop.png'), fullPage: true })

  // Alice starts; Bob follows into the match automatically.
  await alice.getByRole('button', { name: 'START RANKED GAME' }).click()
  await expect(alice).toHaveURL(/\/matches\/[\w-]+$/)
  await expect(bob).toHaveURL(alice.url())
  await expect(bob.getByText('RANKED · The result updates both players’ global ratings.')).toBeVisible()

  // Each player enters only their own darts.
  await expect(bob.getByLabel('Enter dart hits')).toHaveCount(0)
  await expect(bob.locator('.waiting-note')).toContainText('Alice is at the oche.')
  await enter(alice, '20 20 20')
  await expect(bob.locator('.scoreboard .big-score')).toHaveText(['41', '101'])
  await expect(alice.getByLabel('Enter dart hits')).toHaveCount(0)
  await expect(alice.getByRole('button', { name: 'Undo last dart or visit' })).toBeEnabled()
  await enter(bob, '20')
  // The latest dart is Bob's: only he can undo it.
  await expect(alice.getByRole('button', { name: 'Undo last dart or visit' })).toBeDisabled()
  await expect(bob.getByRole('button', { name: 'Undo last dart or visit' })).toBeEnabled()
  await enter(bob, '20 20')
  await expect(bob.locator('.scoreboard .big-score')).toHaveText(['41', '41'])

  // Chat during the game with an unread badge.
  await bob.getByRole('button', { name: 'Open chat' }).click()
  await bob.getByLabel('Chat message').fill('So close!')
  await bob.getByRole('button', { name: 'Send message' }).click()
  await bob.getByRole('button', { name: 'Close chat' }).click()
  await expect(alice.getByRole('button', { name: 'Open chat (1 unread)' })).toBeVisible()

  await enter(alice, '1 D20')
  await expect(alice.getByText('MATCH COMPLETE')).toBeVisible()
  await expect(bob.getByText('Waiting for a player to save the result…')).toHaveCount(0)
  await bob.getByRole('button', { name: 'SAVE RESULT' }).click()
  await expect(alice.getByRole('heading', { name: 'Alice won 1–0' })).toBeVisible()
  await expect(alice.locator('.stats-table')).toContainText('Global rating')
  await expect(alice.locator('.stats-table')).toContainText('1016 (+16)')
  await alice.screenshot({ path: info.outputPath('ranked-result.png'), fullPage: true })

  // The global rankings show both players.
  await alice.goto('/global')
  const rows = alice.locator('.rankings-table tbody tr')
  await expect(rows.filter({ hasText: 'Alice' }).first()).toContainText('1016')
  await expect(rows.filter({ hasText: 'Bob' }).first()).toContainText('984')
  await expect(alice.locator('.rankings-table tr.me')).toContainText('Alice (you)')

  // Back in the lobby, Bob is invited to the next game by "PLAY AGAIN" and follows it.
  await bob.goto(link.replace(/\?.*$/, ''))
  await expect(bob.locator('.lobby-page')).toContainText('Last game')
  await alice.goto(link.replace(/\?.*$/, ''))
  await alice.getByRole('button', { name: 'START RANKED GAME' }).click()
  await expect(bob).toHaveURL(alice.url())
  // Bob throws first in the rematch.
  await expect(bob.getByLabel('Enter dart hits')).toBeVisible()
  // Conceding ends a ranked game; it cannot be abandoned.
  await bob.getByRole('button', { name: 'Match statistics' }).click()
  await expect(bob.getByRole('button', { name: 'ABANDON MATCH' })).toHaveCount(0)
  await bob.getByRole('button', { name: 'CONCEDE MATCH' }).click()
  await bob.getByRole('alertdialog').getByRole('button', { name: 'CONCEDE' }).click()
  await expect(alice.getByRole('heading', { name: 'Alice won 0–0' })).toBeVisible()
  await expect(alice.locator('.league-meta')).toContainText('BOB FORFEITED')
  await Promise.all([alice, bob].map((page) => page.context().close()))
})

test('public lobbies are listed on the global stage, invites arrive live and bots keep games unranked', async ({ browser }, info) => {
  const host = await signIn(browser, 'Host')
  const guest = await signIn(browser, 'Visitor', { width: 390, height: 844 })

  // The host opens a public lobby straight from the Global page.
  await host.goto('/global')
  await host.getByRole('link', { name: 'OPEN A PUBLIC LOBBY' }).click()
  await expect(host.getByRole('heading', { name: 'Your lobby' })).toBeVisible()
  await expect(host.locator('.eyebrow').first()).toContainText('PUBLIC')

  await guest.goto('/global')
  const card = guest.locator('.lobby-card').filter({ hasText: 'Host' })
  await expect(card).toBeVisible({ timeout: 15_000 })
  await guest.screenshot({ path: info.outputPath('global-mobile.png'), fullPage: true })
  await card.getByRole('button', { name: 'JOIN' }).click()
  await expect(guest.getByRole('heading', { name: 'Host’s lobby' })).toBeVisible()
  await expect(host.locator('.seat:not(.open-seat)')).toHaveCount(2)

  // A casual game: anyone signed in may watch, and the visitor concedes.
  await host.getByRole('button', { name: 'START GAME' }).click()
  await expect(guest).toHaveURL(/\/matches\/[\w-]+$/)
  const watcher = await signIn(browser, 'Watcher')
  await watcher.goto('/global')
  await watcher.locator('.lobby-card').filter({ hasText: 'Host' }).filter({ hasText: 'WATCH' }).click()
  await expect(watcher.getByText('Watching live.')).toBeVisible()
  await expect(watcher.getByRole('button', { name: /Open chat/ })).toHaveCount(0)
  await guest.getByRole('button', { name: 'Match statistics' }).click()
  await guest.getByRole('button', { name: 'CONCEDE MATCH' }).click()
  await guest.getByRole('alertdialog').getByRole('button', { name: 'CONCEDE' }).click()
  await expect(host.getByRole('heading', { name: /Host won/ })).toBeVisible()
  await watcher.context().close()
  await guest.getByRole('link', { name: 'LOBBY', exact: true }).click()
  await host.getByRole('link', { name: 'LOBBY', exact: true }).click()
  await expect(guest.getByRole('heading', { name: 'Host’s lobby' })).toBeVisible()

  // The host removes the visitor, then invites them back: a direct invite arrives live.
  const seat = host.locator('.seat').filter({ hasText: 'Visitor' })
  await seat.getByRole('button', { name: 'Remove Visitor' }).click()
  await expect(guest.getByRole('heading', { name: 'You left this lobby' })).toBeVisible()
  await host.getByRole('button', { name: 'INVITE', exact: true }).click()
  const candidate = host.locator('.candidate-row').filter({ hasText: 'Visitor' })
  await expect(candidate).toContainText('Played together')
  // The invites list is refetched once the personal live stream is connected.
  const connected = guest.waitForResponse((response) => response.url().endsWith('/api/me/invites'))
  await guest.goto('/')
  await connected
  await candidate.getByRole('button', { name: 'Invite Visitor' }).click()
  await expect(candidate.getByRole('button', { name: 'Cancel invite for Visitor' })).toBeVisible()
  await host.getByRole('button', { name: 'Close' }).click()
  const toast = guest.locator('.invite-toast')
  await expect(toast).toContainText('Host invited you to play')
  await expect(guest.getByRole('button', { name: '1 game invitations' })).toBeVisible()
  await toast.getByRole('button', { name: 'JOIN' }).click()
  await expect(guest.getByRole('heading', { name: 'Host’s lobby' })).toBeVisible()
  // Only the leader configures the game: everyone else sees the settings read-only.
  await expect(guest.getByRole('group', { name: 'Game' }).getByRole('button', { name: '301' })).toBeDisabled()
  await expect(guest.getByRole('group', { name: 'Lobby visibility' }).getByRole('button', { name: 'PRIVATE' })).toBeDisabled()
  await expect(host.getByRole('group', { name: 'Lobby visibility' }).getByRole('button', { name: 'PRIVATE' })).toBeEnabled()

  // Bots are practice: ranked play is not available with a bot seated.
  await host.getByRole('button', { name: 'ADD A BOT' }).click()
  await host.getByRole('button', { name: 'Add Rookie Rue, level 1, Novice' }).click()
  await host.getByRole('button', { name: 'DONE' }).click()
  await expect(host.locator('.seat').filter({ hasText: 'Rookie Rue' })).toContainText('House bot')
  await expect(host.locator('.lobby-options')).toContainText('Bots and local players keep it unranked.')
  await expect(host.getByRole('group', { name: 'Ranked play' }).getByRole('button', { name: 'RANKED', exact: true })).toBeDisabled()
  await expect(host.locator('.eyebrow').first()).toContainText('UNRANKED')
  await host.screenshot({ path: info.outputPath('public-lobby-bot.png'), fullPage: true })
  await Promise.all([host, guest].map((page) => page.context().close()))
})

test('lobby screens fit phones and light theme', async ({ browser }, info) => {
  const page = await signIn(browser, 'Phone', { width: 320, height: 740 })
  await page.goto('/play')
  await expect(page.getByRole('heading', { name: 'Your lobby' })).toBeVisible()
  await page.getByLabel('Local player name').fill('Dad')
  await page.getByRole('button', { name: 'ADD LOCAL PLAYER' }).click()
  await expect(page.locator('.seat').filter({ hasText: 'Dad' })).toContainText('Plays on Phone’s device')
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: info.outputPath('lobby-320-dark.png'), fullPage: true })
  await page.getByRole('button', { name: 'Account menu for Phone' }).click()
  await page.getByRole('menuitem', { name: 'Light theme' }).click()
  await page.keyboard.press('Escape')
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: info.outputPath('lobby-320-light.png'), fullPage: true })

  // The leader scores for the local player; both play on this device.
  await page.getByRole('button', { name: 'START GAME' }).click()
  await expect(page.getByLabel('Enter dart hits')).toBeVisible()
  await enter(page, 'T20')
  await enter(page, 'M M')
  await expect(page.locator('.turn-context strong')).toHaveText('DAD')
  await expect(page.getByLabel('Enter dart hits')).toBeVisible()
  await expect(page.locator('.turn-context')).toContainText('SCORING FOR')
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: info.outputPath('local-player-match-320.png'), fullPage: true })
  // Unranked lobby games can be abandoned by their leader.
  await page.getByRole('button', { name: 'Match statistics' }).click()
  await page.getByRole('button', { name: 'ABANDON MATCH' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'ABANDON', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your lobby' })).toBeVisible()
  await page.context().close()
})
