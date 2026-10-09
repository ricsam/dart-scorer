import { useId } from 'react'
import '../../stats-progress.css'
import type { TrendPoint } from '../../../shared/api'
import { formatDate, formatRating } from '../../format'
import { formatProgress, metricInfo, progressScale, progressValue, rollingProgress, type ProgressMetric } from '../../progress'

/** Rating after each rated match, starting from 1000. */
export function RatingChart({ points, emptyText = 'The rating chart appears after two rated matches.' }: { points: { at: string; rating: number }[]; emptyText?: string }) {
  if (points.length < 2) return <p className="muted-note">{emptyText}</p>
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

/** Every saved game keeps its place, even without an applicable value. */
export function TrendChart({ points, metric = 'average' }: { points: TrendPoint[]; metric?: ProgressMetric }) {
  const id = useId()
  const info = metricInfo(metric)
  const title = `${info.label} per game`
  const values = points.map((point) => progressValue(point, metric))
  const rolling = rollingProgress(points, metric)
  const { min, max } = progressScale([...values, ...rolling], metric)
  const x = (index: number) => points.length === 1 ? 265 : 44 + index / (points.length - 1) * 432
  const y = (value: number) => 124 - (value - min) / (max - min) * 100
  const line = rolling.map((value, index) => value === null ? '' : `${index === 0 || rolling[index - 1] === null ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')
  const windowSize = Math.min(5, points.length)
  const rollingLabel = `${windowSize}-game ${info.rolling}`
  const hasValues = values.some((value) => value !== null)
  return <section className="trend-chart" aria-labelledby={id}>
    <h3 id={id}>{title}</h3>
    {!points.length ? <p className="muted-note">Save a game to start tracking your progress.</p> : <>
      <p className="trend-summary">Last {points.length} {points.length === 1 ? 'game' : 'games'} · {rollingLabel} <b>{formatProgress(rolling[rolling.length - 1], metric)}</b></p>
      {!hasValues && <p className="muted-note">No {info.label.toLowerCase()} recorded in these games yet. Missing values are shown as —.</p>}
      {hasValues && <>
        <svg viewBox="0 0 500 150" role="img" aria-label={`${title}: ${points.length} games, latest ${rollingLabel} ${formatProgress(rolling[rolling.length - 1], metric)}. Exact results are in the game results table.`}>
          <line x1="44" x2="476" y1="124" y2="124" className="progress-axis" />
          <text x="4" y="28" className="trend-label">{metric === 'checkoutRate' ? '100%' : max}</text>
          <text x="4" y="124" className="trend-label">{metric === 'checkoutRate' ? '0%' : min}</text>
          <path d={line} className="trend-line" />
          {points.map((point, index) => values[index] === null ? null : <circle key={point.matchId} cx={x(index)} cy={y(values[index]!)} r={point.ranked ? 4.5 : 3.5} className={`trend-dot ${point.practice ? 'practice' : point.ranked ? 'ranked' : ''}`}>
            <title>{formatDate(point.at)}: {formatProgress(values[index], metric)}{metric === 'checkoutRate' ? ` (${point.checkouts}/${point.checkoutAttempts} darts)` : ''}</title>
          </circle>)}
        </svg>
        <div className="progress-dates"><span>{formatDate(points[0].at)}</span><span>{formatDate(points[points.length - 1].at)}</span></div>
        <p className="trend-legend"><span><i className="trend-dot-key" /> vs people</span><span><i className="trend-dot-key ranked" /> ranked</span><span><i className="trend-dot-key practice" /> training</span><span><i className="trend-line-key" /> Rolling 5-game {info.rolling}</span></p>
      </>}
      <p className="muted-note progress-explanation">Oldest to newest, up to 50 games. The rolling line uses up to five games, including games without a value.</p>
      <details className="progress-results"><summary>View game results</summary>
        <div className="stats-progress-table" tabIndex={0} role="region" aria-label="Game results table"><table>
          <caption>{title} — game results</caption>
          <thead><tr><th scope="col">Game / date</th><th scope="col">Category</th><th scope="col">{info.label}</th><th scope="col">Rolling {info.rolling}</th></tr></thead>
          <tbody>{points.map((point, index) => <tr key={point.matchId}>
            <th scope="row">{index + 1} · {formatDate(point.at)}</th>
            <td>{point.practice ? 'Training' : point.ranked ? 'Ranked' : 'Competition'}</td>
            <td>{formatProgress(values[index], metric)}{metric === 'checkoutRate' && <small> ({point.checkouts}/{point.checkoutAttempts})</small>}</td>
            <td>{formatProgress(rolling[index], metric)}</td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </>}
  </section>
}
