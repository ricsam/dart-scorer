import type { User, UserRef } from '../src/shared/api'
import type { UserRow } from './context'
import type { Db } from './db'
import { randomId } from './ids'

export const USER_NAME_MAX_LENGTH = 24

export function toUser(row: UserRow): User {
  return { id: row.id, name: row.name, email: row.email, avatarUrl: row.avatar_url, createdAt: row.created_at, guest: row.is_guest === 1 }
}

export function toUserRef(row: { id: string; name: string; avatar_url: string | null }): UserRef {
  return { id: row.id, name: row.name, avatarUrl: row.avatar_url }
}

export function getUser(db: Db, id: string) {
  return db.get<UserRow>('SELECT * FROM users WHERE id = ?', id)
}

/** A default display name from what an identity provider tells us. */
export function defaultDisplayName(candidates: (string | null | undefined)[], email: string | null) {
  for (const candidate of [...candidates, email?.split('@')[0]]) {
    // eslint-disable-next-line no-control-regex
    const cleaned = candidate?.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, USER_NAME_MAX_LENGTH).trim()
    if (cleaned) return cleaned
  }
  return 'Player'
}

/**
 * Finds or creates the user for an external identity. New users get `name`; returning users
 * keep their chosen name and local avatar choice; untouched Google avatars refresh.
 */
export function upsertIdentity(db: Db, input: { subject: string; email: string; name: string; avatarUrl: string | null; now: string }): UserRow {
  return db.transaction(() => {
    const existing = db.get<UserRow>('SELECT * FROM users WHERE google_sub = ?', input.subject)
    if (existing) {
      const avatarUrl = db.get('SELECT 1 FROM user_avatars WHERE user_id = ?', existing.id) ? existing.avatar_url : input.avatarUrl
      db.run('UPDATE users SET email = ?, avatar_url = ?, last_login_at = ? WHERE id = ?', input.email, avatarUrl, input.now, existing.id)
      return { ...existing, email: input.email, avatar_url: avatarUrl, last_login_at: input.now }
    }
    const row: UserRow = {
      id: randomId(),
      is_guest: 0, claimed: 1, guest_league_id: null, guest_name_key: null,
      google_sub: input.subject,
      email: input.email,
      name: input.name,
      avatar_url: input.avatarUrl,
      created_at: input.now,
      last_login_at: input.now,
    }
    db.run(
      'INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      row.id, row.google_sub, row.email, row.name, row.avatar_url, row.created_at, row.last_login_at,
    )
    return row
  })
}
