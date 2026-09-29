type Dart = { label: string; value: number; finish: boolean; rank: number }

const darts: Dart[] = [
  ...Array.from({ length: 20 }, (_, i) => ({ label: `T${20 - i}`, value: (20 - i) * 3, finish: false, rank: 100 - i })),
  { label: 'BULL', value: 50, finish: true, rank: 94 },
  ...Array.from({ length: 20 }, (_, i) => ({ label: `D${20 - i}`, value: (20 - i) * 2, finish: true, rank: 80 - i })),
  { label: '25', value: 25, finish: false, rank: 45 },
  ...Array.from({ length: 20 }, (_, i) => ({ label: `${20 - i}`, value: 20 - i, finish: false, rank: 30 - i })),
]

const preferredCheckouts: Record<number, string[]> = {
  2: ['D1'], 3: ['1', 'D1'], 4: ['D2'], 5: ['1', 'D2'], 6: ['D3'], 7: ['3', 'D2'],
  8: ['D4'], 9: ['1', 'D4'], 10: ['D5'], 11: ['3', 'D4'], 12: ['D6'], 13: ['5', 'D4'],
  14: ['D7'], 15: ['7', 'D4'], 16: ['D8'], 17: ['1', 'D8'], 18: ['D9'], 19: ['3', 'D8'],
  20: ['D10'], 21: ['5', 'D8'], 22: ['D11'], 23: ['7', 'D8'], 24: ['D12'], 25: ['9', 'D8'],
  26: ['D13'], 27: ['11', 'D8'], 28: ['D14'], 29: ['13', 'D8'], 30: ['D15'], 31: ['15', 'D8'],
  32: ['D16'], 33: ['1', 'D16'], 34: ['D17'], 35: ['3', 'D16'], 36: ['D18'], 37: ['5', 'D16'],
  38: ['D19'], 39: ['7', 'D16'], 40: ['D20'], 41: ['9', 'D16'], 42: ['10', 'D16'], 43: ['11', 'D16'],
  44: ['12', 'D16'], 45: ['13', 'D16'], 46: ['14', 'D16'], 47: ['15', 'D16'], 48: ['16', 'D16'],
  49: ['17', 'D16'], 50: ['BULL'], 51: ['19', 'D16'], 52: ['20', 'D16'], 53: ['13', 'D20'],
  54: ['14', 'D20'], 55: ['15', 'D20'], 56: ['16', 'D20'], 57: ['17', 'D20'], 58: ['18', 'D20'],
  59: ['19', 'D20'], 60: ['20', 'D20'], 61: ['T15', 'D8'], 62: ['T10', 'D16'], 63: ['T13', 'D12'],
  64: ['T16', 'D8'], 65: ['25', 'D20'], 66: ['T10', 'D18'], 67: ['T17', 'D8'], 68: ['T20', 'D4'],
  69: ['T19', 'D6'], 70: ['T18', 'D8'], 71: ['T13', 'D16'], 72: ['T16', 'D12'], 73: ['T19', 'D8'],
  74: ['T14', 'D16'], 75: ['T17', 'D12'], 76: ['T20', 'D8'], 77: ['T19', 'D10'], 78: ['T18', 'D12'],
  79: ['T13', 'D20'], 80: ['T20', 'D10'], 81: ['T19', 'D12'], 82: ['BULL', 'D16'], 83: ['T17', 'D16'],
  84: ['T20', 'D12'], 85: ['T15', 'D20'], 86: ['T18', 'D16'], 87: ['T17', 'D18'], 88: ['T16', 'D20'],
  89: ['T19', 'D16'], 90: ['T18', 'D18'], 91: ['T17', 'D20'], 92: ['T20', 'D16'], 93: ['T19', 'D18'],
  94: ['T18', 'D20'], 95: ['T19', 'D19'], 96: ['T20', 'D18'], 97: ['T19', 'D20'], 98: ['T20', 'D19'],
  99: ['T19', '10', 'D16'], 100: ['T20', 'D20'],
  170: ['T20', 'T20', 'BULL'], 167: ['T20', 'T19', 'BULL'], 164: ['T20', 'T18', 'BULL'],
  161: ['T20', 'T17', 'BULL'], 160: ['T20', 'T20', 'D20'], 158: ['T20', 'T20', 'D19'],
  157: ['T20', 'T19', 'D20'], 156: ['T20', 'T20', 'D18'], 155: ['T20', 'T19', 'D19'],
  154: ['T20', 'T18', 'D20'], 153: ['T20', 'T19', 'D18'], 152: ['T20', 'T20', 'D16'],
  151: ['T20', 'T17', 'D20'], 150: ['T20', 'T18', 'D18'], 149: ['T20', 'T19', 'D16'],
  148: ['T20', 'T16', 'D20'], 147: ['T20', 'T17', 'D18'], 146: ['T20', 'T18', 'D16'],
  145: ['T20', 'T15', 'D20'], 144: ['T20', 'T20', 'D12'], 143: ['T20', 'T17', 'D16'],
  142: ['T20', 'T14', 'D20'], 141: ['T20', 'T19', 'D12'], 140: ['T20', 'T20', 'D10'],
  139: ['T19', 'T14', 'D20'], 138: ['T20', 'T18', 'D12'], 137: ['T20', 'T19', 'D10'],
  136: ['T20', 'T20', 'D8'], 135: ['BULL', 'T15', 'D20'], 134: ['T20', 'T14', 'D16'],
  133: ['T20', 'T19', 'D8'], 132: ['BULL', 'T14', 'D20'], 131: ['T20', 'T13', 'D16'],
  130: ['T20', 'T20', 'D5'], 129: ['T19', 'T16', 'D12'], 128: ['T18', 'T14', 'D16'],
  127: ['T20', 'T17', 'D8'], 126: ['T19', 'T19', 'D6'], 125: ['BULL', 'T15', 'D15'],
  124: ['T20', 'T16', 'D8'], 123: ['T19', 'T16', 'D9'], 122: ['T18', 'T18', 'D7'],
  121: ['T20', 'T15', 'D8'], 120: ['T20', '20', 'D20'], 119: ['T19', 'T12', 'D13'],
  118: ['T20', '18', 'D20'], 117: ['T20', '17', 'D20'], 116: ['T20', '16', 'D20'],
  115: ['T20', '15', 'D20'], 114: ['T20', '14', 'D20'], 113: ['T20', '13', 'D20'],
  112: ['T20', '12', 'D20'], 111: ['T20', '11', 'D20'], 110: ['T20', '10', 'D20'],
  109: ['T20', '9', 'D20'], 108: ['T20', '8', 'D20'], 107: ['T19', '10', 'D20'],
  106: ['T20', '6', 'D20'], 105: ['T20', '5', 'D20'], 104: ['T18', '10', 'D20'],
  103: ['T19', '6', 'D20'], 102: ['T20', '10', 'D16'], 101: ['T17', '10', 'D20'],
}

export function findCheckout(score: number, doubleOut: boolean, maxDarts = 3, requiresDoubleIn = false): string[] | null {
  if (score <= 0 || score > 180 || maxDarts < 1 || (doubleOut && (score === 1 || score > 170))) return null

  // For casual single-out games, prefer the obvious single when one dart can finish.
  if (!doubleOut && !requiresDoubleIn && maxDarts >= 1) {
    if (score >= 1 && score <= 20) return [`${score}`]
    if (score === 25) return ['25']
  }

  if (doubleOut && !requiresDoubleIn && preferredCheckouts[score]?.length <= maxDarts) return preferredCheckouts[score]

  const doubles = darts.filter((dart) => dart.finish)
  const finishers = doubleOut ? doubles : darts
  for (let count = 1; count <= maxDarts; count++) {
    let best: { path: Dart[]; quality: number } | null = null
    const search = (path: Dart[], total: number) => {
      if (path.length === count) {
        if (total !== score || (requiresDoubleIn && !path[0].finish) || (doubleOut && !path[path.length - 1].finish)) return
        const quality = path.reduce((sum, dart, index) => sum + dart.rank * (count - index), 0)
        if (!best || quality > best.quality) best = { path: [...path], quality }
        return
      }
      const isFirst = path.length === 0
      const isLast = path.length === count - 1
      const pool = isFirst && requiresDoubleIn ? doubles : isLast ? finishers : darts
      for (const dart of pool) {
        if (total + dart.value <= score) search([...path, dart], total + dart.value)
      }
    }
    search([], 0)
    if (best) return (best as { path: Dart[] }).path.map((dart) => dart.label)
  }
  return null
}

export function findEasyCheckout(score: number, doubleOut: boolean, maxDarts = 3, requiresDoubleIn = false): string[] | null {
  if (score <= 0 || score > 180 || maxDarts < 1 || (doubleOut && (score === 1 || score > 170))) return null

  const doubles = darts.filter((dart) => dart.finish)
  const finishers = doubleOut ? doubles : darts
  let best: { path: Dart[]; effort: number } | null = null

  for (let count = 1; count <= maxDarts; count++) {
    const search = (path: Dart[], total: number) => {
      if (path.length === count) {
        if (total !== score || (requiresDoubleIn && !path[0].finish) || (doubleOut && !path[path.length - 1].finish)) return
        const effort = path.reduce((sum, dart, index) => {
          const requiredDouble = (requiresDoubleIn && index === 0) || (doubleOut && index === path.length - 1)
          const multiplierPenalty = dart.label.startsWith('T') ? 100 : dart.finish && !requiredDouble ? 70 : dart.label === '25' ? 15 : 0
          return sum + multiplierPenalty + 10 + Math.max(0, 20 - Math.min(dart.value, 20)) * 0.01
        }, 0)
        if (!best || effort < best.effort) best = { path: [...path], effort }
        return
      }
      const isFirst = path.length === 0
      const isLast = path.length === count - 1
      const pool = isFirst && requiresDoubleIn ? doubles : isLast ? finishers : darts
      for (const dart of pool) {
        if (total + dart.value <= score) search([...path, dart], total + dart.value)
      }
    }
    search([], 0)
  }

  return best ? (best as { path: Dart[] }).path.map((dart) => dart.label) : null
}

/** Whether a single dart can finish `score` under the out rule. Used for checkout-rate statistics. */
export function isOneDartFinish(score: number, doubleOut: boolean): boolean {
  if (score === 50) return true
  if (doubleOut) return score >= 2 && score <= 40 && score % 2 === 0
  if (score === 25) return true
  if (score >= 1 && score <= 20) return true
  if (score >= 2 && score <= 40 && score % 2 === 0) return true
  return score >= 3 && score <= 60 && score % 3 === 0
}
