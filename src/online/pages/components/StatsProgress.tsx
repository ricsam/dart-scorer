import { useId } from 'react'
import type { StatsHistoryPoint, TrainingMatchTotals } from '../../../shared/api'
import { formatAverage, formatBestLeg, formatPercent } from '../../format'
import { StatTile } from '../../ui'
import { formatProgress, metricInfo, progressScale, progressValue, type ProgressMetric } from '../../progress'
import '../../stats-progress.css'

const monthLabel = (at: string) => new Date(at).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })

export function StatsProgress({ history, title, metric = 'average' }: { history: StatsHistoryPoint[]; title: string; metric?: ProgressMetric }) {
  const id = useId()
  const points = [...history].sort((a, b) => a.at.localeCompare(b.at))
  const values = points.map((point) => progressValue(point, metric))
  const count = values.filter((value) => value !== null).length
  const info = metricInfo(metric)
  const { max } = progressScale(values, metric)
  const x = (index: number) => points.length === 1 ? 265 : 44 + index * 432 / (points.length - 1)
  const y = (value: number) => 124 - value / max * 100
  return <section className="stats-progress" aria-labelledby={id}>
    <h3 id={id}>{title}</h3>
    {points.length === 0 ? <p className="muted-note">No completed matches yet. Monthly progress will appear here.</p> : <>
      {count < 2 && <p className="muted-note">{count === 1 ? 'One month recorded. More months are needed to show progress.' : `No ${info.label.toLowerCase()} recorded yet.`}</p>}
      {count > 0 && <>
        <svg viewBox="0 0 500 150" role="img" aria-label={`${title}: ${info.label}. ${count} monthly values. Exact results and match counts are in the table below.`}>
          <line x1="44" x2="476" y1="124" y2="124" className="progress-axis" />
          <text x="4" y="28" className="trend-label">{metric === 'checkoutRate' ? '100%' : max}</text>
          <text x="4" y="124" className="trend-label">{metric === 'checkoutRate' ? '0%' : 0}</text>
          {points.map((point, index) => values[index] === null ? null : <g key={point.at}>
            {index > 0 && values[index - 1] !== null && <line x1={x(index - 1)} y1={y(values[index - 1]!)} x2={x(index)} y2={y(values[index]!)} className="progress-line" />}
            <circle cx={x(index)} cy={y(values[index]!)} r="4" className="progress-dot"><title>{monthLabel(point.at)}: {formatProgress(values[index], metric)}</title></circle>
          </g>)}
        </svg>
        <div className="progress-dates"><span>{monthLabel(points[0].at)}</span><span>{points.length > 1 ? monthLabel(points[points.length - 1].at) : ''}</span></div>
      </>}
      <div className="stats-progress-table" tabIndex={0} role="region" aria-label="Monthly results table"><table><caption>{title} — monthly results (UTC)</caption><thead><tr><th scope="col">Month</th><th scope="col">{info.label}</th><th scope="col">Matches</th></tr></thead><tbody>
        {points.map((point, index) => <tr key={point.at}><th scope="row">{monthLabel(point.at)}</th><td>{formatProgress(values[index], metric)}{metric === 'checkoutRate' && <small> ({point.checkouts}/{point.checkoutAttempts})</small>}</td><td>{point.matches}</td></tr>)}
      </tbody></table></div>
    </>}
  </section>
}

export function TrainingTotals({ totals }: { totals: TrainingMatchTotals }) {
  return <div className="stat-grid">
    <StatTile label="MATCHES" value={totals.matches} />
    <StatTile label="LEGS PLAYED" value={totals.legsPlayed} />
    <StatTile label="3-DART AVG" value={formatAverage(totals.average)} />
    <StatTile label="FIRST 9 AVG" value={formatAverage(totals.first9Average)} />
    <StatTile label="CHECKOUT" value={formatPercent(totals.checkoutRate, 1)} hint={`${totals.checkouts}/${totals.checkoutAttempts} darts`} />
    <StatTile label="HIGH OUT" value={totals.highestCheckout || '—'} />
    <StatTile label="BEST LEG" value={formatBestLeg(totals.bestLegDarts)} hint={totals.bestLegDarts ? 'darts' : undefined} />
    <StatTile label="180 / 140+ / 100+" value={`${totals.scores180} / ${totals.scores140} / ${totals.scores100}`} />
  </div>
}
