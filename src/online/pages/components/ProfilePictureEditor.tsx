import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { api } from '../../api'
import { useRouter } from '../../router'
import { useSession } from '../../session'
import { Avatar } from '../../ui'
import { prepareProfilePicture } from './prepareProfilePicture'
import './profile-picture.css'

type Draft = { blob: Blob; preview: string } | 'remove' | null

export function ProfilePictureEditor() {
  const { user, setUser } = useSession()
  const router = useRouter()
  const section = useRef<HTMLElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const [draft, setDraft] = useState<Draft>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const focus = () => {
      if (window.location.hash === '#picture') {
        section.current?.scrollIntoView({ block: 'center' })
        section.current?.focus({ preventScroll: true })
      }
    }
    focus()
    window.addEventListener('hashchange', focus)
    return () => window.removeEventListener('hashchange', focus)
  }, [router])
  useEffect(() => () => { generation.current++ }, [])

  if (!user || user.guest) return null

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    const token = ++generation.current
    setBusy(true); setError(''); setMessage('')
    try {
      const prepared = await prepareProfilePicture(file)
      if (generation.current === token) setDraft(prepared)
    } catch (caught) {
      if (generation.current === token) setError(caught instanceof Error ? caught.message : 'Could not prepare this picture.')
    } finally {
      if (generation.current === token) setBusy(false)
    }
  }
  const cancel = () => { setDraft(null); setError(''); setMessage('Changes cancelled.') }
  const save = async () => {
    if (!draft) return
    setBusy(true); setError(''); setMessage('')
    try {
      const response = draft === 'remove' ? await api.removeAvatar() : await api.uploadAvatar(draft.blob)
      setUser(response.user)
      setDraft(null)
      setMessage(draft === 'remove' ? 'Profile picture removed.' : 'Profile picture saved.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save your picture. Try again.') }
    finally { setBusy(false) }
  }
  const previewUrl = draft === 'remove' ? null : draft?.preview ?? user.avatarUrl

  return <section id="picture" className="profile-picture-editor panel" ref={section} tabIndex={-1} aria-labelledby="picture-title">
    <h2 id="picture-title">Profile picture</h2>
    <p>Choose a JPG, PNG or WebP up to 10 MB. We centre-crop it to a square. Your picture is visible to other players.</p>
    <div className="profile-picture-preview" aria-label="Profile picture preview">
      <Avatar user={{ ...user, avatarUrl: previewUrl }} size={112} />
    </div>
    <input ref={fileInput} className="profile-picture-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose profile picture" onChange={(event) => void choose(event)} disabled={busy} />
    <div className="profile-picture-actions">
      <button type="button" className="ghost-button" disabled={busy} onClick={() => fileInput.current?.click()}>Choose picture</button>
      {(user.avatarUrl || (draft && draft !== 'remove')) && <button type="button" className="ghost-button danger" disabled={busy || draft === 'remove'} onClick={() => { setDraft('remove'); setError(''); setMessage('') }}>Remove picture</button>}
      {draft && <>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>Save picture</button>
        <button type="button" className="ghost-button" disabled={busy} onClick={cancel}>Cancel</button>
      </>}
    </div>
    {draft && <p>{draft === 'remove' ? 'Your initials will replace your picture.' : 'Square crop preview.'} Select Save picture to apply, or Cancel to keep your current picture.</p>}
    {busy && <p role="status">Preparing or saving your picture…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>
}
