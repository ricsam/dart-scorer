import { useId, useState } from 'react'
import type { StatsHistoryPoint, TrendPoint } from '../../../shared/api'
import { PROGRESS_METRICS, metricInfo, type ProgressMetric } from '../../progress'
import { TrendChart } from './Charts'
import { StatsProgress } from './StatsProgress'

export function MetricSelect({ metric, onChange }: { metric: ProgressMetric; onChange: (metric: ProgressMetric) => void }) {
  const id = useId()
  return <label className="progress-metric" htmlFor={id}>
    <span>Statistic</span>
    <select id={id} value={metric} onChange={(event) => onChange(event.target.value as ProgressMetric)}>
      {PROGRESS_METRICS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select>
  </label>
}

export function ProgressCharts({ history, trend }: { history: StatsHistoryPoint[]; trend: TrendPoint[] }) {
  const [metric, setMetric] = useState<ProgressMetric>('average')
  const id = useId()
  return <section className="progress-charts" aria-labelledby={id}>
    <div className="progress-heading"><h3 id={id}>Progress over time</h3><MetricSelect metric={metric} onChange={setMetric} /></div>
    <p className="muted-note progress-explanation">{metricInfo(metric).hint}</p>
    <TrendChart points={trend} metric={metric} />
    <StatsProgress history={history} title="Monthly progress" metric={metric} />
  </section>
}
