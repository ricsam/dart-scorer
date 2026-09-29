import { useEffect, useState } from 'react'
import { Check, Copy, RefreshCw, Share2 } from 'lucide-react'
import type { RoomDetail } from '../../../shared/api'
import { api, errorMessage } from '../../api'
import { Sheet } from '../../ui'

export function InviteDialog({ room, onClose, onRegenerated }: { room: RoomDetail; onClose: () => void; onRegenerated: (inviteCode: string) => void }) {
  const link = `${window.location.origin}/join/${room.inviteCode}`
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canShare = typeof navigator.share === 'function'

  useEffect(() => {
    let cancelled = false
    import('qrcode').then((QRCode) => QRCode.toDataURL(link, { margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#07100bff', light: '#ffffffff' } }))
      .then((url) => { if (!cancelled) setQr(url) })
      .catch(() => { if (!cancelled) setQr(null) })
    return () => { cancelled = true }
  }, [link])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      const input = document.getElementById('invite-link') as HTMLInputElement | null
      input?.select()
    }
  }

  const share = async () => {
    try {
      await navigator.share({ title: `Join ${room.name} on Oche`, text: `Join my darts room “${room.name}” on Oche`, url: link })
    } catch {
      // The user closed the share sheet.
    }
  }

  const regenerate = async () => {
    setBusy(true)
    setError(null)
    try {
      const { inviteCode } = await api.regenerateInvite(room.id)
      onRegenerated(inviteCode)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Invite players" eyebrow={room.name.toUpperCase()} onClose={onClose} labelledBy="invite-title">
      <div className="invite-dialog">
        <p className="field-hint">Anyone with this link can sign in with Google and join the room. Scan the code at the board to join from a phone.</p>
        <div className="invite-qr">{qr ? <img src={qr} alt={`QR code for ${link}`} width={180} height={180} /> : <span className="spinner" aria-hidden="true" />}</div>
        <div className="copy-field">
          <input id="invite-link" readOnly value={link} onFocus={(event) => event.currentTarget.select()} aria-label="Invite link" />
          <button className="primary-button" onClick={copy}>{copied ? <><Check size={15} /> COPIED</> : <><Copy size={15} /> COPY</>}</button>
        </div>
        {canShare && <button className="ghost-button full" onClick={share}><Share2 size={15} /> SHARE…</button>}
        {room.role === 'owner' && (
          <div className="invite-reset">
            <span>Shared the link too widely? Resetting it stops the old link from working.</span>
            <button className="ghost-button" onClick={regenerate} disabled={busy}><RefreshCw size={14} /> RESET LINK</button>
          </div>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
    </Sheet>
  )
}
