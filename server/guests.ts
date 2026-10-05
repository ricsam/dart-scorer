import type { Services, UserRow } from './context'
import { nowIso } from './context'
import { badRequest, expectText, forbidden } from './http'
import { randomId } from './ids'
import { USER_NAME_MAX_LENGTH } from './users'

export const MAX_LEAGUE_MEMBERS = 100
export const guestNameKey = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
export const parseGuestName = (value: unknown) => expectText(value, 'Guest name', 1, USER_NAME_MAX_LENGTH)

/** Caller holds a write transaction. Removed identities are tombstones, never silently rejoined. */
export function ensureGuest(services: Services, leagueId: string, name: string): UserRow {
  const { db } = services
  const key = guestNameKey(name)
  if (!key) throw badRequest('Guest name is required.')
  const existing = db.get<UserRow>('SELECT * FROM users WHERE is_guest = 1 AND guest_league_id = ? AND guest_name_key = ?', leagueId, key)
  if (existing) {
    if (!db.get('SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?', leagueId, existing.id)) throw forbidden('This guest was removed. Use a different name.')
    return existing
  }
  const members = db.all<{ name: string }>('SELECT u.name FROM league_members m JOIN users u ON u.id = m.user_id WHERE m.league_id = ?', leagueId)
  if (members.some((member) => guestNameKey(member.name) === key)) throw badRequest('That name belongs to a registered member. Choose another name.')
  if (members.length >= MAX_LEAGUE_MEMBERS) throw badRequest(`This league is full (${MAX_LEAGUE_MEMBERS} members).`)
  const id = randomId()
  const now = nowIso(services)
  db.run("INSERT INTO users (id, google_sub, email, name, created_at, last_login_at, is_guest, guest_league_id, guest_name_key, claimed) VALUES (?, ?, '', ?, ?, ?, 1, ?, ?, 0)", id, `guest:${id}`, name, now, now, leagueId, key)
  db.run("INSERT INTO league_members (league_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)", leagueId, id, now)
  db.run('UPDATE leagues SET updated_at = ? WHERE id = ?', now, leagueId)
  return db.get<UserRow>('SELECT * FROM users WHERE id = ?', id)!
}
