import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { UserRef } from '../shared/api'
import { hueFor, initials } from './format'

export function Avatar({ user, size = 28, className = '' }: { user: Pick<UserRef, 'name' | 'avatarUrl'> & { id?: string }; size?: number; className?: string }) {
  const style = { '--avatar-size': `${size}px`, '--avatar-hue': hueFor(user.id ?? user.name) } as CSSProperties
  return (
    <span className={`avatar ${className}`} style={style} aria-hidden="true">
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" loading="lazy" /> : initials(user.name)}
    </span>
  )
}

export function AvatarStack({ users, max = 5, size = 24 }: { users: (Pick<UserRef, 'name' | 'avatarUrl'> & { id?: string })[]; max?: number; size?: number }) {
  return (
    <span className="avatar-stack">
      {users.slice(0, max).map((user, index) => <Avatar key={user.id ?? `${user.name}-${index}`} user={user} size={size} />)}
    </span>
  )
}

export function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  )
}

export function GoogleButton({ href, label = 'Continue with Google' }: { href: string; label?: string }) {
  return (
    <a className="google-button" href={href}>
      <GoogleMark />
      <span>{label}</span>
    </a>
  )
}

type SheetProps = {
  title: ReactNode
  eyebrow?: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
  labelledBy: string
}

/** Dialog styled like the scorer's settings modal. */
export function Sheet({ title, eyebrow, onClose, children, wide, labelledBy }: SheetProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className={`settings-modal sheet-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={(event) => event.stopPropagation()}>
        <div className="settings-modal-head">
          <div>
            {eyebrow && <span>{eyebrow}</span>}
            <h2 id={labelledBy}>{title}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        {children}
      </section>
    </div>
  )
}

export function Toast({ message, onDismiss, tone = 'info' }: { message: string; onDismiss: () => void; tone?: 'info' | 'error' }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 7000)
    return () => window.clearTimeout(timer)
  }, [message, onDismiss])
  return (
    <div className={`toast ${tone}`} role="status">
      <span>{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss"><X size={14} /></button>
    </div>
  )
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div className="rule-options segmented" role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" className={option.value === value ? 'active' : ''} aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading-state" role="status"><span className="spinner" aria-hidden="true" />{label}</div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <strong>Something went wrong</strong>
      <p>{message}</p>
      {onRetry && <button className="ghost-button" onClick={onRetry}>TRY AGAIN</button>}
    </div>
  )
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat-tile">
      <small>{label}</small>
      <strong>{value}</strong>
      {hint && <span>{hint}</span>}
    </div>
  )
}

export function FormDots({ form }: { form: ('W' | 'L')[] }) {
  if (!form.length) return null
  return (
    <span className="form-dots" aria-label={`Recent form: ${form.join(' ')}`}>
      {form.map((result, index) => <i key={index} className={result === 'W' ? 'win' : 'loss'}>{result}</i>)}
    </span>
  )
}
