import type { PlayerStats } from '../../../game/stats'
import type { MatchPlayer, MatchResult } from '../../../shared/api'
import { formatAverage, formatBestLeg, formatDelta, formatPercent, formatRating } from '../../format'
import { BotAvatar, BotBadge } from '../../BotAvatar'
import { Avatar } from '../../ui'

type Row = { player: MatchPlayer; stats: PlayerStats; legs: number; result?: MatchResult }

/** Side-by-side match statistics, darts-app style: one column per player. */
export function MatchStatsTable({ rows, showRatings = false, ratingLabel = 'League rating' }: { rows: Row[]; showRatings?: boolean; ratingLabel?: string }) {
  const lines: { label: string; values: string[]; best?: 'high' | 'low'; raw?: (number | null)[] }[] = [
    { label: 'Legs won', values: rows.map((row) => String(row.legs)), raw: rows.map((row) => row.legs), best: 'high' },
    { label: '3-dart average', values: rows.map((row) => formatAverage(row.stats.darts ? row.stats.average : null)), raw: rows.map((row) => row.stats.darts ? row.stats.average : null), best: 'high' },
    { label: 'First 9 average', values: rows.map((row) => formatAverage(row.stats.first9Darts ? row.stats.first9Average : null)), raw: rows.map((row) => row.stats.first9Darts ? row.stats.first9Average : null), best: 'high' },
    { label: 'Checkout rate', values: rows.map((row) => row.stats.checkoutAttempts ? `${formatPercent(row.stats.checkoutRate, 1)} (${row.stats.checkouts}/${row.stats.checkoutAttempts})` : '—'), raw: rows.map((row) => row.stats.checkoutRate), best: 'high' },
    { label: 'Highest checkout', values: rows.map((row) => row.stats.highestCheckout ? String(row.stats.highestCheckout) : '—'), raw: rows.map((row) => row.stats.highestCheckout || null), best: 'high' },
    { label: 'Best leg (darts)', values: rows.map((row) => formatBestLeg(row.stats.bestLegDarts)), raw: rows.map((row) => row.stats.bestLegDarts), best: 'low' },
    { label: '180s', values: rows.map((row) => String(row.stats.scores180)), raw: rows.map((row) => row.stats.scores180 || null), best: 'high' },
    { label: '140+', values: rows.map((row) => String(row.stats.scores140)) },
    { label: '100+', values: rows.map((row) => String(row.stats.scores100)) },
    { label: 'Darts thrown', values: rows.map((row) => String(row.stats.darts)) },
  ]
  if (showRatings && !rows.some((row) => row.player.botId)) {
    lines.push({
      label: ratingLabel,
      values: rows.map((row) => row.result?.ratingAfter !== null && row.result?.ratingAfter !== undefined && row.result.ratingBefore !== null
        ? `${formatRating(row.result.ratingAfter)} (${formatDelta(row.result.ratingAfter - row.result.ratingBefore)})`
        : row.player.guest ? 'Guest' : '—'),
    })
  }

  const bestIndexes = (line: (typeof lines)[number]) => {
    if (!line.best || !line.raw || rows.length < 2) return new Set<number>()
    const values = line.raw.filter((value): value is number => value !== null)
    if (!values.length) return new Set<number>()
    const target = line.best === 'high' ? Math.max(...values) : Math.min(...values)
    return new Set(line.raw.flatMap((value, index) => value === target ? [index] : []))
  }

  return (
    <div className="table-scroll">
      <table className="stats-table">
        <thead>
          <tr>
            <th />
            {rows.map((row) => (
              <th key={row.player.slot}>
                <span className="stats-player">
                  {row.player.botId ? <BotAvatar botId={row.player.botId} size={26} /> : <Avatar user={{ id: row.player.userId ?? `guest-${row.player.slot}`, name: row.player.name, avatarUrl: row.player.avatarUrl }} size={26} />}
                  <b>{row.player.name}</b>
                  {row.player.botId ? <BotBadge botId={row.player.botId} /> : row.player.guest && <small>GUEST</small>}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const bests = bestIndexes(line)
            return (
              <tr key={line.label}>
                <th scope="row">{line.label}</th>
                {line.values.map((value, index) => <td key={index} className={bests.has(index) ? 'best' : ''}>{value}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="table-footnote"><a href="/about#statistics" target="_blank" rel="noreferrer">How are these stats calculated? (opens in a new tab)</a></p>
    </div>
  )
}
