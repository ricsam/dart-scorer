import { useState } from 'react'
import type { LeagueDetail } from '../../../shared/api'
import { api } from '../../api'
import { formatAverage, formatBestLeg, formatDate, formatDelta, formatPercent, formatRating } from '../../format'
import { useResource } from '../../hooks'
import { Avatar, ErrorState, FormDots, Loading, Segmented, Sheet, StatTile } from '../../ui'
import { MatchRow } from '../components/MatchRow'
import { StatsProgress, TrainingTotals } from '../components/StatsProgress'

function RatingChart({ points }: { points: { at: string; rating: number }[] }) {
  if (points.length < 2) return <p className="muted-note">The rating chart appears after two ranked matches.</p>
  const series = [1000, ...points.map((point) => point.rating)]
  const min = Math.min(...series) - 10
  const max = Math.max(...series) + 10
  const width = 440
  const height = 96
  const x = (index: number) => (index / (series.length - 1)) * width
  const y = (value: number) => height - ((value - min) / (max - min)) * height
  const line = series.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`
  const baseline = y(1000)
  return (
    <figure className="rating-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Rating history from 1000 to ${formatRating(series[series.length - 1])}`}>
        <line x1="0" x2={width} y1={baseline} y2={baseline} className="baseline" />
        <path d={area} className="area" />
        <path d={line} className="line" />
      </svg>
      <figcaption><span>{formatDate(points[0].at)}</span><span>{formatDate(points[points.length - 1].at)}</span></figcaption>
    </figure>
  )
}

export function PlayerDialog({ league, userId, onClose }: { league: LeagueDetail; userId: string; onClose: () => void }) {
  const stats = useResource(`player:${league.id}:${userId}`, () => api.playerStats(league.id, userId))
  const [mode, setMode] = useState<'competition' | 'training'>('competition')
  const member = league.members.find((item) => item.id === userId)

  return (
    <Sheet title={member?.name ?? stats.data?.player.name ?? 'Player'} eyebrow={`${league.name.toUpperCase()} · PLAYER`} onClose={onClose} labelledBy="player-dialog-title" wide>
      {stats.loading && !stats.data ? <Loading /> : stats.error ? <ErrorState message={stats.error.message} onRetry={stats.reload} /> : stats.data && (
        <div className="player-dialog">
          <div className="stats-mode"><Segmented label="Stats category" value={mode} options={[{ value: 'competition', label: 'Competition' }, { value: 'training', label: 'Training' }]} onChange={setMode} /></div>
          {mode === 'training' ? <section aria-label="Training stats">
            <p className="stats-mode-note">Completed bot matches in this league. Training does not affect competition wins, losses or ratings.</p>
            <TrainingTotals totals={stats.data.training.totals} />
            <StatsProgress history={stats.data.training.history} title="Training monthly average" />
            <h3 className="section-label">RECENT TRAINING MATCHES</h3>
            {stats.data.training.recentMatches.length === 0 ? <p className="muted-note">No completed training matches yet.</p> : <div className="match-list">{stats.data.training.recentMatches.map((match) => <MatchRow key={match.id} match={match} highlightUserId={userId} />)}</div>}
          </section> : <>
          <div className="player-dialog-head">
            <Avatar user={stats.data.player} size={52} />
            <div>
              <strong>{formatRating(stats.data.entry.rating)}<small> RATING</small></strong>
              <span>
                {stats.data.entry.ratingChange !== null && <em className={`delta ${stats.data.entry.ratingChange >= 0 ? 'up' : 'down'}`}>{formatDelta(stats.data.entry.ratingChange)} last match</em>}
                <FormDots form={stats.data.entry.form} />
              </span>
            </div>
          </div>

          <div className="stat-grid">
            <StatTile label="MATCHES" value={stats.data.entry.matches} hint={`${stats.data.entry.wins} W · ${stats.data.entry.losses} L`} />
            <StatTile label="WIN RATE" value={formatPercent(stats.data.entry.winRate)} />
            <StatTile label="LEGS" value={`${stats.data.entry.legsWon}/${stats.data.entry.legsPlayed}`} hint="won / played" />
            <StatTile label="3-DART AVG" value={formatAverage(stats.data.entry.average)} />
            <StatTile label="FIRST 9 AVG" value={formatAverage(stats.data.entry.first9Average)} />
            <StatTile label="CHECKOUT" value={formatPercent(stats.data.entry.checkoutRate, 1)} hint={`${stats.data.entry.checkouts}/${stats.data.entry.checkoutAttempts} darts`} />
            <StatTile label="HIGH OUT" value={stats.data.entry.highestCheckout || '—'} />
            <StatTile label="BEST LEG" value={formatBestLeg(stats.data.entry.bestLegDarts)} hint={stats.data.entry.bestLegDarts ? 'darts' : undefined} />
            <StatTile label="180 / 140+ / 100+" value={`${stats.data.entry.scores180} / ${stats.data.entry.scores140} / ${stats.data.entry.scores100}`} />
          </div>

          <StatsProgress history={stats.data.history} title="Competition monthly average" />
          <h3 className="section-label">RATING HISTORY</h3>
          <RatingChart points={stats.data.ratingHistory} />

          {stats.data.headToHead.length > 0 && (
            <>
              <h3 className="section-label">HEAD TO HEAD</h3>
              <div className="h2h-list">
                {stats.data.headToHead.map((row) => (
                  <div key={row.opponent.id} className="h2h-row">
                    <Avatar user={row.opponent} size={22} />
                    <b>{row.opponent.name}</b>
                    <span className="h2h-bar" aria-hidden="true">
                      <i style={{ flexGrow: row.wins || 0.001 }} className="win" />
                      <i style={{ flexGrow: row.losses || 0.001 }} className="loss" />
                    </span>
                    <em>{row.wins}–{row.losses}</em>
                  </div>
                ))}
              </div>
            </>
          )}

          {stats.data.recentMatches.length > 0 && (
            <>
              <h3 className="section-label">RECENT MATCHES</h3>
              <div className="match-list">
                {stats.data.recentMatches.map((match) => <MatchRow key={match.id} match={match} highlightUserId={userId} />)}
              </div>
            </>
          )}
          </>}
        </div>
      )}
    </Sheet>
  )
}
