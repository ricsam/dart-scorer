import type { DartHit } from './types'

export function parseDart(token: string): DartHit | null {
  const normalized = token.trim().toUpperCase()
  if (!normalized) return null
  if (['M', 'MISS', '0'].includes(normalized)) return { label: 'MISS', value: 0, isDouble: false, counts: true, openedGame: false, isVisitTotal: false }
  if (['BULL', 'DB', 'D25', '50'].includes(normalized)) return { label: 'BULL', value: 50, isDouble: true, counts: true, openedGame: false, isVisitTotal: false }
  if (['SB', 'S25', '25'].includes(normalized)) return { label: '25', value: 25, isDouble: false, counts: true, openedGame: false, isVisitTotal: false }
  if (/^\d+$/.test(normalized) && Number(normalized) > 20) {
    return { label: normalized, value: Number(normalized), isDouble: false, counts: true, openedGame: false, isVisitTotal: false }
  }

  const match = normalized.match(/^([SDT]?)(\d{1,2})$/)
  if (!match) return null
  const number = Number(match[2])
  if (number < 1 || number > 20) return null
  const multiplier = match[1] === 'D' ? 2 : match[1] === 'T' ? 3 : 1
  return {
    label: `${match[1] === 'S' ? '' : match[1]}${number}`,
    value: number * multiplier,
    isDouble: match[1] === 'D',
    counts: true,
    openedGame: false,
    isVisitTotal: false,
  }
}

export function parseDartEntry(source: string): { hits: DartHit[]; error: string | null } {
  const tokens = source.trim().split(/[\s,+]+/).filter(Boolean)
  if (!tokens.length) return { hits: [parseDart('MISS')!], error: null }
  const hits: DartHit[] = []
  for (const token of tokens) {
    const hit = parseDart(token)
    if (!hit) return { hits: [], error: `“${token}” is not a valid dart.` }
    hits.push(hit)
  }
  if (hits.some((hit) => hit.isVisitTotal) && hits.length > 1) {
    return { hits: [], error: 'Enter a total score by itself.' }
  }
  return { hits, error: null }
}

export type EntryEvaluation = {
  hits: DartHit[]
  total: number
  dartsRemaining: number
  /** Validation message for a non-empty entry that cannot be submitted. */
  error: string | null
}

/** Parses a typed entry and checks it against the darts left in the current visit. */
export function evaluateEntry(expression: string, dartsThrownThisVisit: number): EntryEvaluation {
  const dartInput = parseDartEntry(expression)
  const total = dartInput.hits.reduce((sum, hit) => sum + hit.value, 0)
  const dartsRemaining = 3 - dartsThrownThisVisit
  const error = expression.trim() && !dartInput.error && !dartInput.hits[0]?.isVisitTotal && dartInput.hits.length > dartsRemaining
    ? `Only ${dartsRemaining} dart${dartsRemaining === 1 ? '' : 's'} left in this visit.`
    : expression.trim() ? dartInput.error : null
  return { hits: dartInput.hits, total, dartsRemaining, error }
}

/** The recorded edition only accepts scores that one physical dart can hit.
 * The casual standalone parser stays permissive for backwards compatibility. */
export function evaluateOnlineEntry(expression: string, dartsThrownThisVisit: number): EntryEvaluation {
  const result = evaluateEntry(expression, dartsThrownThisVisit)
  if (result.error) return result
  const invalid = result.hits.find(({ value }) => !Number.isSafeInteger(value) || !(value === 0 || value === 25 || value === 50
    || (value >= 1 && value <= 20) || (value <= 40 && value % 2 === 0) || (value <= 60 && value % 3 === 0)))
  return invalid ? { ...result, error: `“${invalid.label}” is not a possible single dart. Enter each dart separately.` } : result
}

export const ENTRY_PATTERN = /^[a-zA-Z0-9\s,+]*$/
