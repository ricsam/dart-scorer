import { describe, expect, it } from 'vitest'
import type { ProgressStats } from '../../src/shared/api'
import { formatProgress, progressScale, progressValue, rollingProgress } from '../../src/online/progress'

const point = (overrides: Partial<ProgressStats> = {}): ProgressStats => ({
  average: null, first9Average: null, checkoutRate: null, points: 0, darts: 0, first9Points: 0, first9Darts: 0,
  checkouts: 0, checkoutAttempts: 0, highestCheckout: 0, bestLegDarts: null, scores180: 0, scores140: 0, scores100: 0,
  ...overrides,
})

describe('progress metrics', () => {
  it('weights rolling rates by attempts and averages by actual darts', () => {
    const points = [
      point({ points: 90, darts: 3, first9Points: 90, first9Darts: 3, checkouts: 1, checkoutAttempts: 1 }),
      point({ points: 30, darts: 9, first9Points: 30, first9Darts: 9, checkouts: 1, checkoutAttempts: 9 }),
    ]
    expect(rollingProgress(points, 'checkoutRate')).toEqual([1, 0.2])
    expect(rollingProgress(points, 'average')).toEqual([90, 30])
    expect(rollingProgress(points, 'first9Average')).toEqual([90, 30])
  })

  it('uses five actual games and does not turn missing opportunities into zero', () => {
    const points = [point({ checkouts: 1, checkoutAttempts: 2 }), ...Array.from({ length: 5 }, () => point())]
    expect(rollingProgress(points, 'checkoutRate')).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, null])
    expect(rollingProgress([point({ checkoutAttempts: 3 })], 'checkoutRate')).toEqual([0])
    expect(progressValue(point(), 'highestCheckout')).toBeNull()
    expect(progressValue(point(), 'bestLegDarts')).toBeNull()
    expect(formatProgress(null, 'checkoutRate')).toBe('—')
    expect(formatProgress(0, 'checkoutRate')).toBe('0.0%')
    expect(formatProgress(0.2, 'checkoutRate')).toBe('20.0%')
  })

  it('uses best records and total counts for rolling milestone metrics', () => {
    const points = [point({ highestCheckout: 100, bestLegDarts: 12, scores180: 1 }), point({ highestCheckout: 40, bestLegDarts: 18, scores180: 2 }), point()]
    expect(rollingProgress(points, 'highestCheckout')).toEqual([100, 100, 100])
    expect(rollingProgress(points, 'bestLegDarts')).toEqual([12, 12, 12])
    expect(rollingProgress(points, 'scores180')).toEqual([1, 3, 3])
    expect(rollingProgress([], 'average')).toEqual([])
    expect(progressScale([null, 0.1], 'checkoutRate')).toEqual({ min: 0, max: 1 })
    expect(progressScale([null, 0], 'scores180').max).toBeGreaterThan(0)
  })
})
