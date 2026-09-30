import { useState } from 'react'
import { ArrowDown, ArrowUp, Award, Crown, Flame, Target, Zap } from 'lucide-react'
import type { LeaderboardEntry, LeaderboardPeriod, RoomDetail } from '../../../shared/api'
import { api } from '../../api'
import { formatAverage, formatBestLeg, formatDelta, formatPercent, formatRating } from '../../format'
import { useResource } from '../../hooks'
import { Avatar, EmptyState, ErrorState, FormDots, Loading, Segmented } from '../../ui'
import { PlayerDialog } from './PlayerDialog'

type SortKey = 'rating' | 'wins' | 'winRate' | 'average' | 'first9Average' | 'checkoutRate' | 'scores180' | 'highestCheckout' | 'bestLegDarts'

type Column = {
  key: SortKey
  label: string
  title: string
  value: (entry: LeaderboardEntry) => number | null
  render: (entry: LeaderboardEntry) => string
  ascending?: boolean
}

const COLUMNS: Column[] = [
  { key: 'rating', label: 'RATING', title: 'Room rating (Elo, starts at 1000)', value: (entry) => entry.rating, render: (entry) => formatRating(entry.rating) },
  { key: 'wins', label: 'W–L', title: 'Matches won and lost', value: (entry) => entry.wins, render: (entry) => `${entry.wins}–${entry.losses}` },
  { key: 'winRate', label: 'WIN %', title: 'Share of matches won', value: (entry) => entry.winRate, render: (entry) => formatPercent(entry.winRate) },
  { key: 'average', label: 'AVG', title: 'Three-dart average', value: (entry) => entry.average, render: (entry) => formatAverage(entry.average) },
  { key: 'first9Average', label: 'FIRST 9', title: 'Average of the first nine darts of each leg', value: (entry) => entry.first9Average, render: (entry) => formatAverage(entry.first9Average) },
  { key: 'checkoutRate', label: 'CO %', title: 'Checkouts hit per dart thrown at a finish', value: (entry) => entry.checkoutRate, render: (entry) => formatPercent(entry.checkoutRate, 1) },
  { key: 'scores180', label: '180S', title: 'Maximums', value: (entry) => entry.scores180, render: (entry) => String(entry.scores180) },
  { key: 'highestCheckout', label: 'HIGH OUT', title: 'Highest checkout', value: (entry) => entry.highestCheckout || null, render: (entry) => entry.highestCheckout ? String(entry.highestCheckout) : '—' },
  { key: 'bestLegDarts', label: 'BEST LEG', title: 'Fewest darts to win a leg', value: (entry) => entry.bestLegDarts, render: (entry) => formatBestLeg(entry.bestLegDarts), ascending: true },
]

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: 'all', label: 'ALL TIME' },
  { value: '30d', label: '30 DAYS' },
  { value: '7d', label: '7 DAYS' },
]

function sortEntries(entries: LeaderboardEntry[], column: Column) {
  const played = entries.filter((entry) => entry.matches > 0)
  const idle = entries.filter((entry) => entry.matches === 0).sort((a, b) => a.name.localeCompare(b.name))
  played.sort((a, b) => {
    const left = column.value(a)
    const right = column.value(b)
    if (left === null && right === null) return b.rating - a.rating
    if (left === null) return 1
    if (right === null) return -1
    if (left !== right) return column.ascending ? left - right : right - left
    return b.rating - a.rating
  })
  return { played, idle }
}

function best(entries: LeaderboardEntry[], pick: (entry: LeaderboardEntry) => number | null, lowest = false) {
  let winner: LeaderboardEntry | null = null
  let winnerValue: number | null = null
  for (const entry of entries) {
    const value = pick(entry)
    if (value === null || value === 0) continue
    if (winnerValue === null || (lowest ? value < winnerValue : value > winnerValue)) {
      winner = entry
      winnerValue = value
    }
  }
  return winner && winnerValue !== null ? { entry: winner, value: winnerValue } : null
}

export function Leaderboard({ room, refreshKey }: { room: RoomDetail; refreshKey: number }) {
  const [period, setPeriod] = useState<LeaderboardPeriod>('all')
  const [sortKey, setSortKey] = useState<SortKey>('rating')
  const [selected, setSelected] = useState<string | null>(null)
  const board = useResource(`leaderboard:${room.id}:${period}:${refreshKey}`, () => api.leaderboard(room.id, period))

  const column = COLUMNS.find((item) => item.key === sortKey) ?? COLUMNS[0]
  const entries = board.data?.entries ?? []
  const { played, idle } = sortEntries(entries, column)

  const highlights = [
    { icon: <Crown size={16} />, label: 'TOP RATED', record: best(played, (entry) => entry.rating), format: (value: number) => formatRating(value) },
    { icon: <Target size={16} />, label: 'BEST AVERAGE', record: best(played, (entry) => entry.average), format: (value: number) => value.toFixed(1) },
    { icon: <Flame size={16} />, label: 'MOST 180S', record: best(played, (entry) => entry.scores180), format: (value: number) => String(value) },
    { icon: <Zap size={16} />, label: 'HIGHEST CHECKOUT', record: best(played, (entry) => entry.highestCheckout), format: (value: number) => String(value) },
    { icon: <Award size={16} />, label: 'BEST LEG', record: best(played, (entry) => entry.bestLegDarts, true), format: (value: number) => `${value} darts` },
  ].filter((item) => item.record)

  return (
    <section className="panel leaderboard-panel" aria-label="Leaderboard">
      <div className="panel-head leaderboard-head">
        <Segmented value={period} options={PERIODS} onChange={setPeriod} label="Leaderboard period" />
        <label className="sort-select">
          <span>SORT BY</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            {COLUMNS.map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}
          </select>
        </label>
      </div>

      {board.loading && !board.data ? <Loading /> : board.error ? <ErrorState message={board.error.message} onRetry={board.reload} /> : (
        <>
          {highlights.length > 0 && (
            <div className="highlights">
              {highlights.map(({ icon, label, record, format }) => record && (
                <button key={label} className="highlight" onClick={() => setSelected(record.entry.id)}>
                  {icon}
                  <small>{label}</small>
                  <strong>{format(record.value)}</strong>
                  <span><Avatar user={record.entry} size={16} /> {record.entry.name}</span>
                </button>
              ))}
            </div>
          )}

          {played.length === 0 ? (
            <EmptyState icon={<Crown size={26} />} title={period === 'all' ? 'No completed matches yet' : 'No matches in this period'}>
              {period === 'all' ? 'Start a match — the leaderboard fills up as soon as the first result is saved.' : 'Try a longer period to see earlier results.'}
            </EmptyState>
          ) : null}

          {entries.length > 0 && (
            <div className="table-scroll">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th className="rank-col">#</th>
                    <th className="player-col">PLAYER</th>
                    {COLUMNS.map((item) => (
                      <th key={item.key} className={item.key === sortKey ? 'sorted' : ''} title={item.title} aria-sort={item.key === sortKey ? (item.ascending ? 'ascending' : 'descending') : 'none'}>
                        <button onClick={() => setSortKey(item.key)}>
                          {item.label}{item.key === sortKey && (item.ascending ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {played.map((entry, index) => (
                    <tr key={entry.id} onClick={() => setSelected(entry.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') setSelected(entry.id) }}>
                      <td className="rank-col"><span className={`rank rank-${index + 1}`}>{index + 1}</span></td>
                      <td className="player-col">
                        <span className="player-cell">
                          <Avatar user={entry} size={26} />
                          <span><b>{entry.name}</b><FormDots form={entry.form} /></span>
                        </span>
                      </td>
                      {COLUMNS.map((item) => (
                        <td key={item.key} className={item.key === sortKey ? 'sorted' : ''}>
                          {item.render(entry)}
                          {item.key === 'rating' && entry.ratingChange !== null && (
                            <small className={`delta ${entry.ratingChange > 0 ? 'up' : entry.ratingChange < 0 ? 'down' : ''}`}>{formatDelta(entry.ratingChange)}</small>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {idle.map((entry) => (
                    <tr key={entry.id} className="idle" onClick={() => setSelected(entry.id)}>
                      <td className="rank-col">–</td>
                      <td className="player-col"><span className="player-cell"><Avatar user={entry} size={26} /><span><b>{entry.name}</b><small>No matches{period === 'all' ? ' yet' : ' in this period'}</small></span></span></td>
                      {COLUMNS.map((item) => (
                        <td key={item.key} className={item.key === sortKey ? 'sorted' : ''}>
                          {item.key === 'rating' ? item.render(entry) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="table-footnote">Ratings are Elo-style and start at 1000; every ranked match between members moves them. Averages count every dart thrown, including busts.</p>
        </>
      )}

      {selected && <PlayerDialog room={room} userId={selected} onClose={() => setSelected(null)} />}
    </section>
  )
}
