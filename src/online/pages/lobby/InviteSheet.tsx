import { useEffect, useState } from 'react'
import { Check, Copy, RefreshCw, Send, Share2 } from 'lucide-react'
import type { InviteCandidate, LobbyDetail } from '../../../shared/api'
import { api, errorMessage } from '../../api'
import { useResource } from '../../hooks'
import { Avatar, ErrorState, Loading, Sheet } from '../../ui'

export function lobbyInviteLink(lobby: Pick<LobbyDetail, 'id' | 'inviteCode'>) {
  return `${window.location.origin}/lobbies/${lobby.id}${lobby.inviteCode ? `?code=${lobby.inviteCode}` : ''}`
}

/** Share the lobby link or QR code; the leader can also invite people they know directly. */
export function InviteSheet({ lobby, onClose, onLobby }: { lobby: LobbyDetail; onClose: () => void; onLobby: (lobby: LobbyDetail) => void }) {
  const leader = lobby.role === 'leader'
  const link = lobbyInviteLink(lobby)
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const candidates = useResource(leader ? `invite-candidates:${lobby.id}` : null, () => api.inviteCandidates(lobby.id))
  const canShare = typeof navigator.share === 'function'

  useEffect(() => {
    let cancelled = false
    import('qrcode').then((QRCode) => QRCode.toDataURL(link, { margin: 1, width: 320, errorCorrectionLevel: 'M', color: { dark: '#07100bff', light: '#ffffffff' } }))
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
      (document.getElementById('lobby-invite-link') as HTMLInputElement | null)?.select()
    }
  }

  const run = async (key: string, action: () => Promise<{ lobby: LobbyDetail }>) => {
    setBusy(key)
    setError(null)
    try {
      onLobby((await action()).lobby)
      void candidates.reload()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  const invite = (candidate: InviteCandidate) => run(candidate.id, () => candidate.invited ? api.cancelInvite(lobby.id, candidate.id) : api.invitePlayer(lobby.id, candidate.id))

  return (
    <Sheet title="Invite players" eyebrow={lobby.visibility === 'public' ? 'PUBLIC LOBBY' : 'PRIVATE LOBBY'} onClose={onClose} labelledBy="lobby-invite-title">
      <div className="invite-dialog">
        <p className="field-hint">{lobby.visibility === 'public'
          ? 'Anyone signed in can find this lobby on the Global page. Share the link to bring friends straight in.'
          : 'Only people with this link or a direct invite can join. Scan the code at the board to join from a phone.'}</p>
        <div className="invite-qr">{qr ? <img src={qr} alt={`QR code for ${link}`} width={180} height={180} /> : <span className="spinner" aria-hidden="true" />}</div>
        <div className="copy-field">
          <input id="lobby-invite-link" readOnly value={link} onFocus={(event) => event.currentTarget.select()} aria-label="Lobby invite link" />
          <button className="primary-button" onClick={copy}>{copied ? <><Check size={15} /> COPIED</> : <><Copy size={15} /> COPY</>}</button>
        </div>
        {canShare && <button className="ghost-button full" onClick={() => { void navigator.share({ title: 'Play darts on Oche', text: 'Join my darts lobby on Oche', url: link }).catch(() => {}) }}><Share2 size={15} /> SHARE…</button>}

        {leader && (
          <section className="invite-people" aria-labelledby="invite-people-title">
            <h3 id="invite-people-title" className="section-label">PEOPLE YOU KNOW</h3>
            {candidates.loading && !candidates.data ? <Loading label="Finding your friends…" /> : candidates.error ? <ErrorState message={candidates.error.message} onRetry={candidates.reload} /> : candidates.data && (
              candidates.data.candidates.length === 0
                ? <p className="muted-note">League members and people you have played with appear here. Share the link with anyone else.</p>
                : <div className="candidate-list">
                  {candidates.data.candidates.map((candidate) => (
                    <div className="candidate-row" key={candidate.id}>
                      <span className="presence-avatar"><Avatar user={candidate} size={30} /><i className={candidate.online ? 'online' : ''} aria-hidden="true" /></span>
                      <span className="candidate-name"><b>{candidate.name}</b><small>{candidate.online ? 'Online' : 'Offline'} · {candidate.via}</small></span>
                      {candidate.member
                        ? <span className="role-pill">IN LOBBY</span>
                        : <button className={candidate.invited ? 'ghost-button' : 'primary-button'} disabled={busy === candidate.id} onClick={() => void invite(candidate)} aria-label={`${candidate.invited ? 'Cancel invite for' : 'Invite'} ${candidate.name}`}>
                          {candidate.invited ? <><Check size={14} /> INVITED</> : <><Send size={14} /> INVITE</>}
                        </button>}
                    </div>
                  ))}
                </div>
            )}
          </section>
        )}

        {leader && (
          <div className="invite-reset">
            <span>Shared the link too widely? A new link stops the old one from working.</span>
            <button className="ghost-button" onClick={() => void run('rotate', () => api.rotateLobbyCode(lobby.id))} disabled={busy === 'rotate'}><RefreshCw size={14} /> NEW LINK</button>
          </div>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
    </Sheet>
  )
}
