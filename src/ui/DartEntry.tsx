import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Delete, X } from 'lucide-react'
import { ENTRY_PATTERN, evaluateEntry, evaluateOnlineEntry, type EntryEvaluation } from '../game/entry'
import type { DartHit } from '../game/types'

export const QUICK_DARTS = ['T20', 'T19', 'T18', 'T17', 'T16', 'D20', 'D18', 'D16', 'D12', 'D10', '20', '19', '18', '17', '16', '25', 'BULL', 'MISS']

type DartEntryOptions = {
  /** Darts already thrown in the visit being entered. */
  dartsThrown: number
  /** Whether an entry may currently be submitted (for example, not while a leg-complete dialog is open). */
  canSubmit: boolean
  strict?: boolean
  /** Stops typing anywhere on the page from being captured into the entry field. */
  captureBlocked: boolean
  onSubmit: (entry: string) => void
  /** Challenges can validate batches beyond a normal three-dart visit. */
  evaluate?: (expression: string) => EntryEvaluation
  /** Async persistence can clear explicitly after a confirmed save instead. */
  clearOnSubmit?: boolean
}

/** Typed dart entry state shared by matches and training challenges. */
export function useDartEntry({ dartsThrown, canSubmit, captureBlocked, onSubmit, strict = false, evaluate, clearOnSubmit = true }: DartEntryOptions) {
  const [expression, setExpression] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const evaluation = useMemo(() => evaluate ? evaluate(expression) : (strict ? evaluateOnlineEntry : evaluateEntry)(expression, dartsThrown), [expression, dartsThrown, strict, evaluate])

  const focus = () => inputRef.current?.focus()
  const focusSoon = () => window.setTimeout(() => inputRef.current?.focus(), 0)

  const update = (value: string) => {
    if (ENTRY_PATTERN.test(value)) setExpression(value.toUpperCase())
  }

  const addDart = (value: string) => {
    setExpression((current) => `${current}${current.trim() ? ' ' : ''}${value}`)
    focus()
  }

  const clear = () => setExpression('')

  const submit = () => {
    if (!canSubmit || evaluation.error) return
    onSubmit(expression)
    if (clearOnSubmit) setExpression('')
    focusSoon()
  }

  const captureTyping = useEffectEvent((event: KeyboardEvent) => {
    if (captureBlocked) return

    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
    if (target?.closest('button') && (event.key === ' ' || event.key === 'Enter')) return

    if (event.key.length === 1 && /^[a-zA-Z0-9,+ ]$/.test(event.key)) {
      event.preventDefault()
      focus()
      setExpression((current) => `${current}${event.key.toUpperCase()}`)
    } else if (event.key === 'Backspace' && expression) {
      event.preventDefault()
      focus()
      setExpression((current) => current.slice(0, -1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      focus()
      submit()
    }
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => captureTyping(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  return { expression, evaluation, inputRef, update, addDart, clear, submit, focus, focusSoon, canSubmit }
}

export type DartEntryController = ReturnType<typeof useDartEntry>

type DartEntryProps = {
  entry: DartEntryController
  currentVisit: DartHit[]
  disabled?: boolean
  progress?: ReactNode
  hint?: ReactNode
  placeholder?: string
  quickDarts?: string[]
}

export function DartEntry({ entry, currentVisit, disabled = false, progress, hint, placeholder, quickDarts = QUICK_DARTS }: DartEntryProps) {
  const { expression, evaluation, inputRef } = entry
  const dartsRemaining = evaluation.dartsRemaining
  const entryError = evaluation.error

  return (
    <div className="calculator dart-entry">
      {progress ?? <div className="visit-progress">
        <span>THIS VISIT</span>
        <div className="dart-slots">
          {[0, 1, 2].map((index) => (
            <span className={currentVisit[index] ? 'filled' : index === currentVisit.length ? 'next' : ''} key={index}>
              {currentVisit[index]?.label ?? `DART ${index + 1}`}
            </span>
          ))}
        </div>
        <strong>{currentVisit.reduce((sum, hit) => sum + (hit.counts ? hit.value : 0), 0)}</strong>
      </div>}
      <div
        className={`calc-display ${entryError ? 'has-error' : ''}`}
        onClick={() => inputRef.current?.focus()}
      >
        <div className="expression">
          <input
            ref={inputRef}
            autoFocus
            disabled={disabled}
            value={expression}
            onChange={(event) => entry.update(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                entry.submit()
              } else if (event.key === 'Escape') {
                entry.clear()
              }
            }}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-label="Enter dart hits"
            placeholder={placeholder ?? (dartsRemaining === 3 ? 'e.g. T20 D20 or 20 5 D18' : `Enter dart ${currentVisit.length + 1}`)}
          />
        </div>
        <strong className={entryError ? 'invalid' : ''}>{expression ? (entryError ? '—' : evaluation.total) : '0'}</strong>
        <button className="clear-key" disabled={disabled} onClick={entry.clear} aria-label="Clear entry"><Delete size={22} /></button>
      </div>
      {entryError && <div className="entry-error" role="alert">{entryError}</div>}
      <div className="keypad dart-pad">
        {quickDarts.map((dart) => (
          <button
            key={dart}
            className={dart.startsWith('T') ? 'triple' : dart.startsWith('D') || dart === 'BULL' ? 'double' : ''}
            onClick={() => entry.addDart(dart)}
            disabled={disabled || dartsRemaining === 0}
          >{dart}</button>
        ))}
        <button className="clear-all" disabled={disabled} onClick={entry.clear}><X size={17} /> CLEAR</button>
        <button className="enter-score" onClick={entry.submit} disabled={disabled || !entry.canSubmit || Boolean(entryError)}>
          <Check size={20} strokeWidth={3} /> {expression.trim() ? `ADD DART${evaluation.hits.length === 1 ? '' : 'S'}` : 'ADD MISS'}
        </button>
      </div>
      <p className="calc-hint">{hint ?? <>Type <b>36</b> for one dart; use <b>D18</b> or <b>T12</b> when the ring matters</>}</p>
    </div>
  )
}
