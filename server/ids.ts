import { createHash, randomBytes } from 'node:crypto'

/** Random URL-safe identifier (22 characters, 128 bits). */
export function randomId() {
  return randomBytes(16).toString('base64url')
}

/** Random URL-safe secret, e.g. session tokens and OAuth state (base64url of `bytes` random bytes). */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

export function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function sha256Base64Url(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

/** No 0/O, 1/I/L: easy to read aloud and type. */
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const INVITE_CODE_LENGTH = 10
const INVITE_PATTERN = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`)

export function randomInviteCode() {
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % INVITE_ALPHABET.length)
  let code = ''
  while (code.length < INVITE_CODE_LENGTH) {
    for (const byte of randomBytes(INVITE_CODE_LENGTH * 2)) {
      if (byte >= limit) continue
      code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length]
      if (code.length === INVITE_CODE_LENGTH) break
    }
  }
  return code
}

/** Normalizes a user-supplied invite code, or returns null when it cannot be valid. */
export function normalizeInviteCode(value: string) {
  const code = value.trim().toUpperCase()
  return INVITE_PATTERN.test(code) ? code : null
}
