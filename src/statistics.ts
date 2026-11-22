import jStat from 'jstat'

export function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return String(Number(value.toPrecision(6)))
}

export function summarize(values: number[]) {
  let mean = 0, sumSquares = 0, n = 0
  for (const value of values) {
    n++
    const delta = value - mean
    mean += delta / n
    sumSquares += delta * (value - mean)
  }
  return {
    n, mean: n ? mean : null,
    variance: n ? sumSquares / n : null,
    sampleVariance: n > 1 ? sumSquares / (n - 1) : null,
  }
}

export function empiricalCDF(values: number[]): [number, number][] {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return []
  const points: [number, number][] = [[sorted[0], 0]]
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i + 1]) points.push([sorted[i], (i + 1) / sorted.length])
  }
  return points
}

export function meanTest(summary: ReturnType<typeof summarize>, hypothesized: number) {
  const { n, mean, sampleVariance } = summary
  if (mean === null || sampleVariance === null || !(sampleVariance > 0) || !Number.isFinite(sampleVariance)) return null
  const t = (mean - hypothesized) / Math.sqrt(sampleVariance / n)
  if (!Number.isFinite(t)) return null
  const df = n - 1
  const p = jStat.ibeta(df / (df + t * t), df / 2, 0.5)
  return Number.isFinite(p) ? { t, df, p: Math.max(0, Math.min(1, p)) } : null
}

export function linearFit(points: [number, number][]) {
  if (points.length < 2) return null
  let meanX = 0, meanY = 0, xx = 0, xy = 0, yy = 0
  let min = Infinity, max = -Infinity
  for (const [i, [x, y]] of points.entries()) {
    const dx = x - meanX, dy = y - meanY
    meanX += dx / (i + 1)
    meanY += dy / (i + 1)
    xx += dx * (x - meanX)
    xy += dx * (y - meanY)
    yy += dy * (y - meanY)
    min = Math.min(min, x)
    max = Math.max(max, x)
  }
  const slope = xy / xx, intercept = meanY - slope * meanX
  if (!(xx > 0) || !Number.isFinite(slope) || !Number.isFinite(intercept)) return null
  const r2 = yy > 0 ? Math.min(1, Math.max(0, (xy / Math.sqrt(xx) / Math.sqrt(yy)) ** 2)) : null
  const ends = [min, max].map(x => [x, meanY + slope * (x - meanX)])
  return { slope, intercept, r2, ends }
}
