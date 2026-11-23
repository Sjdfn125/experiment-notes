import { numericValue, readCell, type ChartType, type Experiment, type Column } from './records'

type Label = ChartType | 'skip'
type Features = [number, number, number, number, number]
// Original labeled profiles. Dimensions: text X, time-like X, order, uniqueness, time-like Y.
const examples: [Features, Label][] = [
  [[1, 0, 0, .2, 0], 'bar'], [[1, 0, 0, 1, 0], 'bar'], [[1, 0, 0, .6, 0], 'bar'],
  [[0, 1, 1, 1, 0], 'line'], [[0, 1, .6, .8, 0], 'line'], [[0, 1, 1, .4, 0], 'line'],
  [[0, 0, .2, 1, 0], 'scatter'], [[0, 0, 1, 1, 0], 'scatter'], [[0, 0, .4, .35, 0], 'scatter'],
  [[0, 0, 1, .8, 1], 'skip'], [[0, 0, .4, .4, 1], 'skip'], [[1, 0, 0, .5, 1], 'skip'],
]
function temporal(column: Column): number {
  return Number(/时间|时刻|时长|日期|年份|周期|time|duration/i.test(column.name)
    || /^(秒|分钟|小时|年|天|ms|min|s|h)$/i.test(column.unit))
}

function classify(features: Features) {
  const neighbors = examples.map(([sample, label]) => ({
    label, distance: sample.reduce((sum, v, i) => sum + (v - features[i]) ** 2, 0),
  })).sort((a,b) => a.distance - b.distance).slice(0, 3)
  const votes = new Map<Label, number>()
  let total = 0
  for (const {label, distance} of neighbors) {
    const weight = 1 / (.05 + distance)
    votes.set(label, (votes.get(label) ?? 0) + weight)
    total += weight
  }
  const [label, weight] = [...votes].sort((a,b) => b[1] - a[1])[0]
  return {label, score: weight / total / (1 + neighbors[0].distance)}
}

export interface Suggestion {
  type: ChartType
  x: Column
  y: Column
  count: number
  score: number
}

export function recommend(record: Experiment): Suggestion[] {
  const best = new Map<ChartType, Suggestion>()
  const columns = record.columns.map(col => ({ col, values: record.rows.map(row => {
    const raw = readCell(row, col, record.columns).trim()
    return col.kind === 'number' ? numericValue(raw) : (raw || null)
  }) }))
  for (const x of columns) {
    for (const y of columns) {
      if (x === y || y.col.kind !== 'number') continue
      const pairs = x.values.filter((v, i) => v !== null && y.values[i] !== null)
      const count = pairs.length, distinct = new Set(pairs).size
      if (count < 2 || distinct < 2) continue
      let rising = 0, falling = 0
      if (x.col.kind === 'number') for (let i = 1; i < count; i++) {
        if (Number(pairs[i]) >= Number(pairs[i - 1])) rising++
        if (Number(pairs[i]) <= Number(pairs[i - 1])) falling++
      }
      const {label, score} = classify([Number(x.col.kind === 'text'), temporal(x.col), Math.max(rising, falling) / (count - 1), distinct / count, temporal(y.col)])
      if (label === 'skip' || (label === 'scatter' && x.col.kind === 'text')) continue
      const candidate = { type: label, x: x.col, y: y.col, count, score: score * count / record.rows.length }
      if (candidate.score > (best.get(label)?.score ?? -1)) best.set(label, candidate)
    }
  }
  return [...best.values()].sort((a,b) => b.score - a.score)
}
