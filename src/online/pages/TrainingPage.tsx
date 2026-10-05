import { useState } from 'react'
import { ArrowRight, Bot, Target, Users } from 'lucide-react'
import type { LeagueDetail } from '../../shared/api'
import { TRAINING_MODES, type TrainingMode, type TrainingSession } from '../../shared/training'
import { api, errorMessage } from '../api'
import { formatAverage, formatDateTime } from '../format'
import { useDocumentTitle, useResource } from '../hooks'
import { Link, useRouter } from '../router'
import { useSession } from '../session'
import { EmptyState, ErrorState, Loading, StatTile } from '../ui'
import { NewMatchDialog } from './league/NewMatchDialog'
import { MatchRow } from './components/MatchRow'
import { StatsProgress } from './components/StatsProgress'
import '../training.css'

export function TrainingPage() {
  useDocumentTitle('Training arena — Oche')
  const { user } = useSession()
  const { navigate } = useRouter()
  const leagues = useResource('training-leagues', api.leagues)
  const sessions = useResource('training-sessions', api.trainingSessions)
  const botStats = useResource(user && !user.guest ? 'training-bot-stats' : null, api.myStats)
  const [leagueId, setLeagueId] = useState('')
  const league = useResource(leagueId || null, () => api.league(leagueId))
  const [mode, setMode] = useState<TrainingMode>('around-clock')
  const [companions, setCompanions] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [botLeague, setBotLeague] = useState<LeagueDetail | null>(null)
  const all = sessions.data?.sessions ?? []
  const live = all.filter((session) => session.status === 'live')
  const completed = all.filter((session) => session.status === 'completed')
  const definition = TRAINING_MODES.find((item) => item.id === mode)!

  const start = async () => {
    if (busy || !user) return
    setBusy(true)
    setError(null)
    try {
      const { session } = await api.createTraining({ mode, ...(leagueId ? { leagueId, playerIds: [user.id, ...companions] } : {}) })
      navigate(`/training/${session.id}`)
    } catch (caught) { setError(errorMessage(caught)); setBusy(false) }
  }

  return <div className="page training-page">
    <div className="page-head"><div><span className="eyebrow">PRACTICE WITH PURPOSE</span><h1>Training arena</h1><p className="training-intro">Your space to improve. Play solo, bring your crew, or take on a house bot. No ratings. No win/loss record.</p></div><Target className="arena-mark" size={52} /></div>
    <div className="training-modes">
      {TRAINING_MODES.map((item) => <button key={item.id} className={`panel training-mode ${mode === item.id ? 'selected' : ''}`} aria-pressed={mode === item.id} onClick={() => setMode(item.id)}><Target size={24} /><strong>{item.name}</strong><span>{item.description}</span><small>SOLO OR MULTIPLAYER <ArrowRight size={13} /></small></button>)}
      <section className="panel training-mode bot-practice"><Bot size={24} /><h2>House bot practice</h2><p>Six rivals, six levels. Play 101–701 with automatic opponents and keep your training averages.</p><small>CHOOSE A LEAGUE BELOW TO PLAY</small></section>
    </div>
    <section className="panel training-setup" aria-labelledby="training-setup-title">
      <div className="panel-head"><h2 id="training-setup-title">Make it your session</h2><Users size={18} /></div>
      <div className="training-setup-body">
        <label className="field"><span>Play space</span><select value={leagueId} disabled={busy} onChange={(event) => { setLeagueId(event.target.value); setCompanions([]); setError(null) }}><option value="">Solo · private practice</option>{leagues.data?.leagues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {leagues.error && <ErrorState message={leagues.error.message} onRetry={leagues.reload} />}
        {leagueId && league.loading && !league.data && <Loading label="Loading players…" />}
        {leagueId && league.error && <ErrorState message={league.error.message} onRetry={league.reload} />}
        {league.data && <div><p className="field-hint">You are playing. Add up to seven league players or guests. Take turns on one device, or open the session link on their devices.</p><div className="member-picker">{league.data.league.members.filter((member) => member.id !== user?.id).map((member) => <button type="button" key={member.id} aria-pressed={companions.includes(member.id)} className={companions.includes(member.id) ? 'picked' : ''} disabled={busy || (!companions.includes(member.id) && companions.length >= 7)} onClick={() => setCompanions((current) => current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id])}>{member.name}{member.guest && <small>GUEST</small>}</button>)}</div></div>}
        {!leagueId && <p className="field-hint">Solo challenges need no league. For bots or friends, select a league. <Link to="/">Create or join a league →</Link></p>}
        <div className="training-start-actions"><button className="primary-button" disabled={busy || (!!leagueId && (!league.data || !!league.error))} onClick={start}>{busy ? 'STARTING…' : `START ${definition.name.toUpperCase()}`} <ArrowRight size={15} /></button><button className="ghost-button" disabled={busy || !league.data || !!league.error} onClick={() => league.data && setBotLeague(league.data.league)}><Bot size={16} /> PLAY BOTS</button></div>
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
    </section>
    {sessions.loading && !sessions.data ? <Loading /> : sessions.error ? <ErrorState message={sessions.error.message} onRetry={sessions.reload} /> : <>
      {live.length > 0 && <section className="panel"><div className="panel-head"><h2>Continue training</h2></div><div className="training-session-list">{live.map((session) => <SessionLink key={session.id} session={session} />)}</div></section>}
      <ChallengeProgress sessions={completed} userId={user?.id ?? ''} />
      <section className="panel"><div className="panel-head"><h2>Challenge history</h2><span className="panel-sub">Latest saved sessions</span></div>{completed.length ? <div className="training-session-list">{completed.map((session) => <SessionLink key={session.id} session={session} />)}</div> : <EmptyState title="Your next personal best starts here">Complete a challenge to keep your score and track your practice over time.</EmptyState>}</section>
    </>}
    {!user?.guest && (botStats.error ? <ErrorState message={botStats.error.message} onRetry={botStats.reload} /> : botStats.data && <section className="panel"><div className="panel-head"><h2>Bot practice progress</h2><Link to="/me">ALL MY STATS →</Link></div><div className="stat-grid"><StatTile label="TRAINING MATCHES" value={botStats.data.training.totals.matches} /><StatTile label="3-DART AVG" value={formatAverage(botStats.data.training.totals.average)} /><StatTile label="180s" value={botStats.data.training.totals.scores180} /></div><StatsProgress history={botStats.data.training.history} title="Bot practice · monthly average" /><div className="match-list">{botStats.data.training.recentMatches.map((match) => <MatchRow key={match.id} match={match} leagueName={match.leagueName} />)}</div></section>)}
    {botLeague && <NewMatchDialog league={botLeague} botsInitiallyOpen requireBot onClose={() => setBotLeague(null)} />}
  </div>
}

function SessionLink({ session }: { session: TrainingSession }) {
  return <Link className="training-session-link" to={`/training/${session.id}`}><span><b>{TRAINING_MODES.find((mode) => mode.id === session.mode)?.name}</b><small>{session.players.map((player) => player.name).join(' · ')} · {session.leagueName ?? 'Private practice'}</small></span><span><small>{formatDateTime(session.completedAt ?? session.createdAt)}</small><b>{session.status === 'live' ? 'CONTINUE →' : 'RESULTS →'}</b></span></Link>
}

function ChallengeProgress({ sessions, userId }: { sessions: TrainingSession[]; userId: string }) {
  const [mode, setMode] = useState<TrainingMode>('around-clock')
  const mine = sessions.filter((session) => session.mode === mode).flatMap((session) => {
    const result = session.results.find((item) => item.playerId === userId)
    return result ? [{ result, at: session.completedAt! }] : []
  })
  const months = new Map<string, { sessions: number; score: number; best: number }>()
  for (const { result, at } of mine) {
    const key = at.slice(0, 7)
    const month = months.get(key) ?? { sessions: 0, score: 0, best: 0 }
    month.sessions += 1; month.score += result.score; month.best = Math.max(month.best, result.score)
    months.set(key, month)
  }
  const best = mine.length ? Math.max(...mine.map(({ result }) => result.score)) : null
  const quickest = mine.filter(({ result }) => result.hits === 20).map(({ result }) => result.darts)
  return <section className="panel" aria-labelledby="challenge-progress-title"><div className="panel-head"><h2 id="challenge-progress-title">Your challenge progress</h2><select aria-label="Progress challenge" value={mode} onChange={(event) => setMode(event.target.value as TrainingMode)}>{TRAINING_MODES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><p className="table-footnote">Based on your latest 100 accessible challenge sessions. Modes are kept separate; unfinished sessions do not count.</p><div className="stat-grid"><StatTile label="SESSIONS" value={mine.length} /><StatTile label={mode === 'around-clock' ? 'BEST TARGETS HIT' : 'PERSONAL BEST'} value={best === null ? '—' : mode === 'around-clock' ? `${best}/20` : best} /><StatTile label={mode === 'around-clock' ? 'QUICKEST FULL CLOCK' : 'AVERAGE SCORE'} value={mode === 'around-clock' ? (quickest.length ? `${Math.min(...quickest)} darts` : '—') : mine.length ? (mine.reduce((sum, item) => sum + item.result.score, 0) / mine.length).toFixed(1) : '—'} /></div>{months.size > 0 && <div className="training-table-wrap"><table className="training-progress-table"><caption>Monthly {mode === 'around-clock' ? 'targets hit (out of 20)' : 'nine-dart scores'} · UTC</caption><thead><tr><th>Month</th><th>Sessions</th><th>Average</th><th>Best</th></tr></thead><tbody>{[...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => <tr key={month}><th>{month}</th><td>{value.sessions}</td><td>{(value.score / value.sessions).toFixed(1)}</td><td>{value.best}</td></tr>)}</tbody></table></div>}</section>
}
