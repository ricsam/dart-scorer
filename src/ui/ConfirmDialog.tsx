import type { ReactNode } from 'react'

type ConfirmDialogProps = {
  icon: ReactNode
  eyebrow: string
  title: ReactNode
  titleId: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onCancel: () => void
  onConfirm: () => void
  backdropClassName?: string
  className?: string
  busy?: boolean
}

export function ConfirmDialog({ icon, eyebrow, title, titleId, children, confirmLabel, cancelLabel = 'CANCEL', onCancel, onConfirm, backdropClassName, className, busy }: ConfirmDialogProps) {
  return (
    <div className={backdropClassName ? `modal-backdrop ${backdropClassName}` : 'modal-backdrop'} onClick={onCancel}>
      <div className={className ? `confirm-modal ${className}` : 'confirm-modal'} role="alertdialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        {icon}
        <span>{eyebrow}</span>
        <h2 id={titleId}>{title}</h2>
        <p>{children}</p>
        <div>
          <button onClick={onCancel}>{cancelLabel}</button>
          <button className="danger" onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
