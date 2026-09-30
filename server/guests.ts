import type { Services, UserRow } from './context'
import { nowIso } from './context'
import { badRequest, expectText, forbidden } from './http'
import { randomId } from './ids'
import { USER_NAME_MAX_LENGTH } from './users'

export const MAX_ROOM_MEMBERS = 100
export const guestNameKey = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
export const parseGuestName = (value: unknown) => expectText(value, 'Guest name', 1, USER_NAME_MAX_LENGTH)

/** Caller holds a write transaction. Removed identities are tombstones, never silently rejoined. */
export function ensureGuest(services: Services, roomId: string, name: string): UserRow {
  const { db } = services
  const key = guestNameKey(name)
  if (!key) throw badRequest('Guest name is required.')
  const existing = db.get<UserRow>('SELECT * FROM users WHERE is_guest = 1 AND guest_room_id = ? AND guest_name_key = ?', roomId, key)
  if (existing) {
    if (!db.get('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?', roomId, existing.id)) throw forbidden('This guest was removed. Use a different name.')
    return existing
  }
  const members = db.all<{ name: string }>('SELECT u.name FROM room_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ?', roomId)
  if (members.some((member) => guestNameKey(member.name) === key)) throw badRequest('That name belongs to a registered member. Choose another name.')
  if (members.length >= MAX_ROOM_MEMBERS) throw badRequest(`This room is full (${MAX_ROOM_MEMBERS} members).`)
  const id = randomId()
  const now = nowIso(services)
  db.run("INSERT INTO users (id, google_sub, email, name, created_at, last_login_at, is_guest, guest_room_id, guest_name_key, claimed) VALUES (?, ?, '', ?, ?, ?, 1, ?, ?, 0)", id, `guest:${id}`, name, now, now, roomId, key)
  db.run("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)", roomId, id, now)
  db.run('UPDATE rooms SET updated_at = ? WHERE id = ?', now, roomId)
  return db.get<UserRow>('SELECT * FROM users WHERE id = ?', id)!
}
