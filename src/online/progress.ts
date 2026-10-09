import type { ProgressStats } from '../shared/api'
import { formatAverage, formatPercent } from './format'

export const PROGRESS_METRICS = [
  { key: 'average', label: '3-dart average', rolling: 'average', hint: 'Total points ÷ darts × 3. Averages are weighted by darts thrown.' },
  { key: 'first9Average', label: 'First-nine average', rolling: 'average', hint: 'Points from the first nine darts of each leg ÷ those darts × 3.' },
  { key: 'checkoutRate', label: 'Checkout rate', rolling: 'rate', hint: 'Total checkouts ÷ darts thrown with a one-dart finish available. No attempts is —, not 0%.' },
  { key: 'highestCheckout', label: 'Highest checkout', rolling: 'best', hint: 'Highest score finished in one visit. No checkout is shown as —.' },
  { key: 'bestLegDarts', label: 'Best leg', rolling: 'best', hint: 'Fewest darts in a winning leg. Lower is better; no winning leg is —.' },
  { key: 'scores180', label: '180s', rolling: 'total', hint: 'Number of 180 visits in each game or month; the rolling line totals up to five games.' },
  { key: 'scores140', label: '140+ visits', rolling: 'total', hint: 'Number of visits scoring 140–179. 180s are counted separately.' },
  { key: 'scores100', label: '100+ visits', rolling: 'total', hint: 'Number of visits scoring 100–139. Higher scoring visits are counted separately.' },
] as const
export type ProgressMetric = typeof PROGRESS_METRICS[number]['key']
export const metricInfo = (metric: ProgressMetric) => PROGRESS_METRICS.find((item) => item.key === metric)!

export function progressValue(stats: ProgressStats, metric: ProgressMetric): number | null {
  const value = stats[metric]
  return metric === 'highestCheckout' && value === 0 ? null : value
}

export function formatProgress(value: number | null, metric: ProgressMetric): string {
  if (value === null) return '—'
  if (metric === 'checkoutRate') return formatPercent(value, 1)
  if (metric === 'average' || metric === 'first9Average') return formatAverage(value)
  return metric === 'bestLegDarts' ? `${value} darts` : String(value)
}

/** Use the last five actual games, never the last five non-null observations. */
export function rollingProgress(points: ProgressStats[], metric: ProgressMetric): (number | null)[] {
  return points.map((_, index) => {
    const window = points.slice(Math.max(0, index - 4), index + 1)
    const sum = (key: keyof ProgressStats) => window.reduce((total, point) => total + (point[key] ?? 0), 0)
    if (metric === 'average') return sum('darts') ? sum('points') / sum('darts') * 3 : null
    if (metric === 'first9Average') return sum('first9Darts') ? sum('first9Points') / sum('first9Darts') * 3 : null
    if (metric === 'checkoutRate') return sum('checkoutAttempts') ? sum('checkouts') / sum('checkoutAttempts') : null
    const values = window.map((point) => progressValue(point, metric)).filter((value): value is number => value !== null)
    if (!values.length) return null
    if (metric === 'highestCheckout') return Math.max(...values)
    if (metric === 'bestLegDarts') return Math.min(...values)
    return sum(metric)
  })
}

export function progressScale(values: (number | null)[], metric: ProgressMetric) {
  if (metric === 'checkoutRate') return { min: 0, max: 1 }
  const defined = values.filter((value): value is number => value !== null)
  const max = Math.max(1, ...defined)
  return { min: 0, max: Math.ceil(max * 1.1) }
}
