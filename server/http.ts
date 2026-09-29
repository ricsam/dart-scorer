import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ApiError } from '../src/shared/api'

export type ApiErrorCode = ApiError['error']

/** Thrown anywhere in a handler; rendered as `ApiError` JSON by the app's error handler. */
export class ApiException extends Error {
  readonly status: ContentfulStatusCode
  readonly code: ApiErrorCode
  readonly extra: Record<string, unknown> | undefined

  constructor(status: ContentfulStatusCode, code: ApiErrorCode, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

export const badRequest = (message: string) => new ApiException(400, 'bad_request', message)
export const unauthorized = (message = 'Sign in to continue.') => new ApiException(401, 'unauthorized', message)
export const forbidden = (message = 'You are not allowed to do that.') => new ApiException(403, 'forbidden', message)
export const notFound = (message = 'Not found.') => new ApiException(404, 'not_found', message)
export const rateLimited = (message = 'Too many requests. Try again in a minute.') => new ApiException(429, 'rate_limited', message)

export function errorResponse(c: Context, status: ContentfulStatusCode, code: ApiErrorCode, message: string, extra?: Record<string, unknown>) {
  return c.json({ ...extra, error: code, message }, status)
}

// ── JSON bodies ─────────────────────────────────────────────────────────────

export const BODY_LIMIT_BYTES = 64 * 1024

const tooLarge = () => new ApiException(413, 'bad_request', 'Request body is too large.')

/** Reads and parses a JSON request body with a size limit. */
export async function readJson(c: Context): Promise<unknown> {
  const declared = c.req.header('content-length')
  if (declared !== undefined && Number(declared) > BODY_LIMIT_BYTES) throw tooLarge()
  const body = c.req.raw.body
  if (!body) throw badRequest('A JSON request body is required.')

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > BODY_LIMIT_BYTES) {
      await reader.cancel().catch(() => {})
      throw tooLarge()
    }
    chunks.push(value)
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
  } catch {
    throw badRequest('Request body is not valid UTF-8.')
  }
  if (!text.trim()) throw badRequest('A JSON request body is required.')
  try {
    return JSON.parse(text)
  } catch {
    throw badRequest('Request body is not valid JSON.')
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

export type JsonObject = Record<string, unknown>

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function expectObject(value: unknown, what = 'Request body'): JsonObject {
  if (!isObject(value)) throw badRequest(`${what} must be a JSON object.`)
  return value
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

/** Trimmed display text with a length range and no control characters. */
export function expectText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw badRequest(`${field} must be a string.`)
  const text = value.trim()
  if (text.length < min) throw badRequest(min <= 1 ? `${field} is required.` : `${field} must be at least ${min} characters.`)
  if (text.length > max) throw badRequest(`${field} must be at most ${max} characters.`)
  if (CONTROL_CHARACTERS.test(text)) throw badRequest(`${field} contains invalid characters.`)
  return text
}

/** A raw (untrimmed) string with a maximum length. */
export function expectString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw badRequest(`${field} must be a string.`)
  if (value.length > max) throw badRequest(`${field} must be at most ${max} characters.`)
  return value
}

export function expectInteger(value: unknown, field: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw badRequest(`${field} must be an integer.`)
  if (value < min || value > max) throw badRequest(`${field} must be between ${min} and ${max}.`)
  return value
}

export function expectBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false.`)
  return value
}

/** Parses an optional integer query parameter. */
export function queryInteger(value: string | undefined, field: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === '') return fallback
  if (!/^\d+$/.test(value)) throw badRequest(`${field} must be an integer.`)
  return expectInteger(Number(value), field, min, max)
}

/** Path parameters are ids we generated: reject anything else early (treated as not found). */
export function validId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}
