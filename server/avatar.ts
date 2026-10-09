import { Hono, type MiddlewareHandler } from 'hono'
import sharp from 'sharp'
import type { UpdateMeResponse } from '../src/shared/api'
import { requireUser } from './auth'
import type { Config } from './config'
import type { AppEnv, Services } from './context'
import { ApiException, badRequest, forbidden, notFound, rateLimited } from './http'
import { randomId } from './ids'
import { getUser, toUser } from './users'

export const AVATAR_MAX_BYTES = 10 * 1024 * 1024
const FORMATS: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }
const tooLarge = () => new ApiException(413, 'bad_request', 'Choose a picture no larger than 10 MB.')

/** Only this binary PUT bypasses the ordinary JSON guard. Origin is mandatory. */
export function avatarUploadGuard(config: Config): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.header('origin') !== config.publicOrigin || c.req.header('sec-fetch-site') === 'cross-site') throw forbidden('Cross-origin request rejected.')
    return next()
  }
}

export function avatarRoutes({ db }: Services) {
  const app = new Hono<AppEnv>()
  // Bound decoding concurrency as well as body and decoded pixel size.
  let active = 0
  app.put('/me/avatar', async (c) => {
    const user = requireUser(c)
    if (user.is_guest) throw forbidden('Guests cannot update profiles.')
    const format = FORMATS[(c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase()]
    if (!format) throw new ApiException(415, 'bad_request', 'Choose a JPG, PNG or WebP picture.')
    if (Number(c.req.header('content-length')) > AVATAR_MAX_BYTES) throw tooLarge()
    if (active >= 2) throw rateLimited('Picture processing is busy. Try again shortly.')
    active++
    try {
      const reader = c.req.raw.body?.getReader()
      if (!reader) throw badRequest('A picture is required.')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > AVATAR_MAX_BYTES) {
            await reader.cancel().catch(() => {})
            throw tooLarge()
          }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      if (!size) throw badRequest('A picture is required.')
      let image: Buffer
      try {
        const decoder = sharp(Buffer.concat(chunks), { limitInputPixels: 40_000_000, failOn: 'warning' })
        const metadata = await decoder.metadata()
        if (metadata.format !== format || (metadata.pages ?? 1) !== 1) throw new Error('Unsupported image')
        // Auto-orient before centre cropping, discard metadata, and re-encode all bytes.
        image = await decoder.rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toBuffer()
      } catch { throw badRequest('This picture could not be read. Choose a still JPG, PNG or WebP under 40 megapixels.') }
      const version = randomId()
      const avatarUrl = `/api/avatars/${encodeURIComponent(user.id)}/${version}.webp`
      db.transaction(() => {
        db.run('INSERT INTO user_avatars (user_id, version, image) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET version = excluded.version, image = excluded.image', user.id, version, image)
        db.run('UPDATE users SET avatar_url = ? WHERE id = ?', avatarUrl, user.id)
      })
      return c.json<UpdateMeResponse>({ user: toUser(getUser(db, user.id)!) })
    } finally { active-- }
  })

  app.delete('/me/avatar', (c) => {
    const user = requireUser(c)
    if (user.is_guest) throw forbidden('Guests cannot update profiles.')
    db.transaction(() => {
      db.run('INSERT INTO user_avatars (user_id, version, image) VALUES (?, ?, NULL) ON CONFLICT(user_id) DO UPDATE SET version = excluded.version, image = NULL', user.id, randomId())
      db.run('UPDATE users SET avatar_url = NULL WHERE id = ?', user.id)
    })
    return c.json<UpdateMeResponse>({ user: toUser(getUser(db, user.id)!) })
  })

  // Avatars are public like Google pictures; unguessable versions cannot serve older blobs.
  app.get('/avatars/:userId/:file', (c) => {
    const row = db.get<{ image: Uint8Array; version: string }>('SELECT image, version FROM user_avatars WHERE user_id = ? AND image IS NOT NULL', c.req.param('userId'))
    if (!row || c.req.param('file') !== `${row.version}.webp`) throw notFound('Picture not found.')
    return c.body(new Uint8Array(row.image), 200, {
      'Content-Type': 'image/webp',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=86400, immutable',
      'Content-Length': String(row.image.byteLength),
    })
  })
  return app
}
