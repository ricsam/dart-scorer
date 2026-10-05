import { useId } from 'react'
import '../../stats-progress.css'
import type { TrendPoint } from '../../../shared/api'
import { formatAverage, formatDate, formatRating } from '../../format'

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

/**
 * 3-dart average of each recent game, oldest first, with a rolling five-game average so a trend
 * stands out from single good or bad nights. Training and competition games use different marks.
 */
export function TrendChart({ points, title = 'Average per game' }: { points: TrendPoint[]; title?: string }) {
  const id = useId()
  const values = points.filter((point): point is TrendPoint & { average: number } => point.average !== null)
  if (values.length < 2) return <section className="trend-chart" aria-labelledby={id}><h3 id={id}>{title}</h3><p className="muted-note">Play a couple of games to see your average game by game.</p></section>
  const width = 500
  const height = 150
  const pad = 22
  const max = Math.max(...values.map((point) => point.average), 1)
  const min = Math.min(...values.map((point) => point.average), max)
  const top = max + Math.max(4, (max - min) * 0.15)
  const bottom = Math.max(0, min - Math.max(4, (max - min) * 0.15))
  const x = (index: number) => pad + (index / (values.length - 1)) * (width - pad * 2)
  const y = (value: number) => height - pad - ((value - bottom) / (top - bottom || 1)) * (height - pad * 2)
  const rolling = values.map((_, index) => {
    const window = values.slice(Math.max(0, index - 4), index + 1)
    return window.reduce((sum, point) => sum + point.average, 0) / window.length
  })
  const line = rolling.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')
  const recent = rolling[rolling.length - 1]
  const earlier = rolling[Math.min(rolling.length - 1, 4)]
  const change = recent - earlier
  return (
    <section className="trend-chart" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <p className="trend-summary">Last {values.length} games · 5-game average <b>{formatAverage(recent)}</b>{values.length > 5 && <> · <span className={change >= 0 ? 'up' : 'down'}>{change >= 0 ? '+' : '−'}{Math.abs(change).toFixed(1)}</span> since game 5</>}</p>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${values.length} games, latest five-game average ${formatAverage(recent)}.`}>
        <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} className="progress-axis" />
        <text x={pad} y={y(top) + 10} className="trend-label">{Math.round(top)}</text>
        <text x={pad} y={height - pad - 4} className="trend-label">{Math.round(bottom)}</text>
        <path d={line} className="trend-line" />
        {values.map((point, index) => (
          <circle key={point.matchId} cx={x(index)} cy={y(point.average)} r={point.ranked ? 4.5 : 3.5} className={`trend-dot ${point.practice ? 'practice' : point.ranked ? 'ranked' : ''}`}>
            <title>{formatDate(point.at)}: {formatAverage(point.average)}{point.practice ? ' (training)' : point.ranked ? ' (ranked)' : ''}</title>
          </circle>
        ))}
      </svg>
      <p className="trend-legend"><span><i className="trend-dot-key" /> vs people</span><span><i className="trend-dot-key ranked" /> ranked</span><span><i className="trend-dot-key practice" /> training</span><span><i className="trend-line-key" /> 5-game average</span></p>
    </section>
  )
}
