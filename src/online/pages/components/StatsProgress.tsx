import { useId } from 'react'
import type { StatsHistoryPoint, TrainingMatchTotals } from '../../../shared/api'
import { formatAverage, formatBestLeg, formatPercent } from '../../format'
import { StatTile } from '../../ui'
import '../../stats-progress.css'

const monthLabel = (at: string) => new Date(at).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })

export function StatsProgress({ history, title }: { history: StatsHistoryPoint[]; title: string }) {
  const id = useId()
  const points = [...history].sort((a, b) => a.at.localeCompare(b.at))
  const values = points.filter((point) => point.average !== null)
  const max = Math.max(1, ...values.map((point) => point.average!))
  const x = (index: number) => points.length === 1 ? 250 : 24 + index * 452 / (points.length - 1)
  const y = (average: number) => 124 - average / max * 100
  return <section className="stats-progress" aria-labelledby={id}>
    <h3 id={id}>{title}</h3>
    {points.length === 0 ? <p className="muted-note">No completed matches yet. Monthly averages will appear here.</p> : <>
      {values.length < 2 && <p className="muted-note">{values.length === 1 ? 'One monthly average recorded. More months are needed to show progress.' : 'No scoring average recorded yet.'}</p>}
      {values.length > 0 && <svg viewBox="0 0 500 150" role="img" aria-label={`${title}. ${values.length} monthly averages. Exact averages and match counts are in the table below.`}>
        <line x1="24" x2="476" y1="124" y2="124" className="progress-axis" />
        {points.map((point, index) => point.average === null ? null : <g key={point.at}>
          {index > 0 && points[index - 1].average !== null && <line x1={x(index - 1)} y1={y(points[index - 1].average!)} x2={x(index)} y2={y(point.average)} className="progress-line" />}
          <circle cx={x(index)} cy={y(point.average)} r="4" className="progress-dot"><title>{monthLabel(point.at)}: {formatAverage(point.average)}</title></circle>
        </g>)}
      </svg>}
      <div className="stats-progress-table"><table><caption>{title} — monthly results</caption><thead><tr><th scope="col">Month</th><th scope="col">3-dart average</th><th scope="col">Matches</th></tr></thead><tbody>
        {points.map((point) => <tr key={point.at}><th scope="row">{monthLabel(point.at)}</th><td>{formatAverage(point.average)}</td><td>{point.matches}</td></tr>)}
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
