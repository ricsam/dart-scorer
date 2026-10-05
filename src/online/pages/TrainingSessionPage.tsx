import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, Trash2, Undo2 } from 'lucide-react'
import { evaluateTrainingEntry, TRAINING_MODES, type TrainingResponse } from '../../shared/training'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { DartEntry, useDartEntry } from '../../ui/DartEntry'
import { api, ApiRequestError, errorMessage } from '../api'
import { useDocumentTitle, useResource } from '../hooks'
import { Link, useRouter } from '../router'
import { ErrorState, Loading } from '../ui'
import '../training.css'

export function TrainingSessionPage({ sessionId }: { sessionId: string }) {
  const resource = useResource(`training:${sessionId}`, () => api.trainingSession(sessionId))
  const session = resource.data?.session
  const { setData } = resource
  const { navigate } = useRouter()
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const mode = TRAINING_MODES.find((item) => item.id === session?.mode)
  useDocumentTitle(`${mode?.name ?? 'Training'} — Oche`)

  const live = session?.status === 'live'
  // Poll sequentially, never replay a mutation. Version checks prevent stale reads
  // from replacing a dart accepted while a refresh was in flight.
  useEffect(() => {
    if (!live) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const response = await api.trainingSession(sessionId)
        if (!disposed) {
          setOffline(false)
          setData((current) => !current || response.session.version >= current.session.version ? response : current)
        }
      } catch { if (!disposed) setOffline(true) }
      if (!disposed) timer = setTimeout(refresh, 2000)
    }
    timer = setTimeout(refresh, 2000)
    return () => { disposed = true; clearTimeout(timer) }
  }, [sessionId, live, setData]) // Keep the poll stable across individual darts.

  const act = async (action: { type: 'submit'; entry: string } | { type: 'undo' }): Promise<void> => {
    if (!session || sending.current || offline) return
    sending.current = true; setBusy(true); setError(null)
    try {
      const response = await api.trainingAction(sessionId, session.version, action)
      setData((current) => !current || response.session.version >= current.session.version ? response : current)
      entry.clear()
      entry.focusSoon()
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 409 && caught.body?.session) {
        const latest = caught.body.session as TrainingResponse['session']
        setData((current) => !current || latest.version >= current.session.version ? { session: latest } : current)
      }
      setError(errorMessage(caught))
      // A lost response is not proof of failure; refresh before allowing another dart.
      try {
        const response = await api.trainingSession(sessionId)
        setData((current) => !current || response.session.version >= current.session.version ? response : current)
      } catch { setOffline(true) }
    } finally { sending.current = false; setBusy(false) }
  }

  const complete = session?.status === 'completed'
  const canScore = Boolean(session?.canScore && !complete && !busy && !offline && !deleteOpen && !resource.error)
  const entry = useDartEntry({
    dartsThrown: 0,
    canSubmit: canScore,
    captureBlocked: !canScore,
    clearOnSubmit: false,
    evaluate: (value) => session
      ? evaluateTrainingEntry(session.mode, session.players, session.state, value.trim() ? value : 'MISS')
      : { hits: [], total: 0, dartsRemaining: 0, error: null },
    onSubmit: (value) => { void act({ type: 'submit', entry: value.trim() ? value : 'MISS' }) },
  })

  if (resource.loading && !session) return <Loading />
  if (resource.error) return <ErrorState message={resource.error.message} onRetry={resource.reload} />
  if (!session || !mode) return null
  const active = session.results[session.state.active]

  return <div className="page training-session-page">
    <div className="page-head"><div><Link className="eyebrow crumb" to="/training"><ArrowLeft size={13} /> TRAINING ARENA</Link><h1>{mode.name}</h1><p className="training-intro">{mode.description}</p><span className="bot-badge">TRAINING ONLY · {session.leagueName ?? 'PRIVATE'}</span></div><div className="page-actions">{session.leagueId && <button className="ghost-button" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true) } catch { setError('Copy the address from your browser to share with league members.') } }}><Copy size={14} /> {copied ? 'LINK COPIED' : 'COPY SESSION LINK'}</button>}{session.canDelete && <button className="ghost-button danger" disabled={busy} onClick={() => setDeleteOpen(true)}><Trash2 size={15} /> {complete ? 'DELETE' : 'ABANDON'}</button>}</div></div>
    {offline && <div className="form-error" role="alert">Connection lost. Scoring is paused while we reconnect. Your saved darts are safe.</div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="training-scoreboard">{session.results.map((result, slot) => <section key={result.playerId} className={`panel training-player ${!complete && slot === session.state.active ? 'active' : ''}`}><small>{complete ? 'SAVED RESULT' : result.finished ? 'FINISHED' : slot === session.state.active ? 'AT THE OCHE' : 'UP NEXT'}</small><h2>{result.name}</h2><strong>{session.mode === 'around-clock' ? `${result.hits}/20` : result.points}</strong><span>{session.mode === 'around-clock' ? 'targets hit' : 'points'} · {result.darts}/{session.mode === 'around-clock' ? 60 : 9} darts</span>{result.hits === 20 && session.mode === 'around-clock' && <b>Full clock in {result.darts} darts</b>}</section>)}</div>
    {complete ? <section className="panel training-complete"><h2>Training complete</h2><p>Results saved for every player. No wins, losses or ratings affected.</p><Link to="/training" className="primary-button">VIEW PROGRESS & PLAY AGAIN <ArrowLeft size={14} /></Link></section> : <section className="panel training-scoring" aria-labelledby="training-turn-title"><div className="panel-head"><h2 id="training-turn-title">{active?.name}’s turn</h2><span className="panel-sub">Dart {(active?.darts ?? 0) % 3 + 1} of 3</span></div><div className="training-target"><small>{session.mode === 'around-clock' ? 'AIM FOR' : 'BUILD YOUR SCORE'}</small><strong>{session.mode === 'around-clock' ? (active?.hits ?? 0) + 1 : `${9 - (active?.darts ?? 0)} darts left`}</strong><span>{session.mode === 'around-clock' ? 'Any ring of the target advances one number. Finish 1–20 within 60 darts.' : 'Nine darts. Every point counts. Maximum score: 540.'}</span></div>{session.canScore ? <div className="training-entry" aria-busy={busy}>
      <DartEntry
        entry={entry}
        currentVisit={[]}
        disabled={!canScore}
        placeholder={session.mode === 'around-clock' ? 'e.g. 1 D2 3 MISS 4' : 'e.g. T20 T20 20 T19 MISS'}
        quickDarts={session.mode === 'around-clock' ? [...Array.from({ length: 20 }, (_, i) => String(i + 1)), '25', 'BULL', 'MISS'] : undefined}
        progress={<div className="visit-progress training-batch-progress"><span>{busy ? 'SAVING…' : 'BATCH ENTRY'}</span><b>{entry.expression.trim() ? entry.evaluation.hits.length : 0} darts entered</b><span>Up to {entry.evaluation.dartsRemaining} left</span></div>}
        hint={<>Enter one or more darts, separated by spaces, commas or +. More than three is fine.{session.mode === 'around-clock' ? ' Use D or T for doubles or triples (e.g. D2, T3).' : ' Each value must be one physical dart, not a visit total.'}</>}
      />
      <button className="text-button" type="button" disabled={!canScore || !session.state.throws.length} onClick={() => void act({ type: 'undo' })}><Undo2 size={14} /> UNDO LAST DART</button>
      <p className="field-hint">Keypad taps build your entry; press ADD DARTS to save the whole batch. Undo removes one saved dart until the session finishes.{session.players.length > 1 && ` Darts follow the playing order, starting with ${active?.name}. Every three darts move to the next unfinished player, so a batch can include multiple players’ turns.`}</p>
    </div> : <p className="table-footnote">Watching this league’s training. Only participants can enter darts. Updates refresh every two seconds.</p>}</section>}
    {session.state.throws.length > 0 && <section className="panel"><div className="panel-head"><h2>Recent darts</h2><span className="panel-sub">Latest 30</span></div><ol className="training-darts">{session.state.throws.slice(-30).map((dart, index, recent) => <li key={session.state.throws.length - recent.length + index}><span>{session.players[dart.slot].name}</span><b>{dart.entry}</b></li>)}</ol></section>}
    {deleteOpen && <ConfirmDialog icon={<Trash2 size={30} />} eyebrow="TRAINING SESSION" title={complete ? 'Delete this training result?' : 'Abandon this training session?'} titleId="delete-training-title" confirmLabel={busy ? 'REMOVING…' : 'REMOVE SESSION'} onCancel={() => !busy && setDeleteOpen(false)} onConfirm={async () => { if (sending.current) return; sending.current = true; setBusy(true); try { await api.deleteTraining(sessionId); navigate('/training') } catch (caught) { setError(errorMessage(caught)); setDeleteOpen(false) } finally { sending.current = false; setBusy(false) } }}>This session and its progress data will be removed for all participants. Other training and match records are unchanged.</ConfirmDialog>}
  </div>
}
