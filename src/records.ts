export type ChartType = 'line' | 'bar' | 'scatter'

export interface Column {
  id: string
  name: string
  unit: string
  kind: 'number' | 'text'
}

export interface Row {
  id: string
  values: Record<string, string>
}

export interface ChartConfig {
  trend?: boolean
  analysisColumn?: string
  nullMean?: string
  alpha?: string
  type: ChartType
  xId: string
  yId: string
  title: string
  color: string
}

export interface Experiment {
  id: string
  name: string
  columns: Column[]
  rows: Row[]
  chart: ChartConfig
}

export interface Workspace {
  version: 1
  activeId: string
  records: Experiment[]
}

export const STORAGE_KEY = 'experiment-notes/workspace/v1'
export const DEFAULT_COLOR = '#087f71'

export function newRow(): Row {
  return { id: crypto.randomUUID(), values: {} }
}

export function newColumn(name: string, unit = '', kind: Column['kind'] = 'number'): Column {
  return { id: crypto.randomUUID(), name, unit, kind }
}

export function newExperiment(name: string, columns = [newColumn('时间', '秒'), newColumn('测量值')]): Experiment {
  return {
    id: crypto.randomUUID(),
    name,
    columns,
    rows: [newRow(), newRow(), newRow()],
    chart: { type: 'line', xId: columns[0].id, yId: columns[1].id, title: '', color: DEFAULT_COLOR },
  }
}

export function newSample(): Experiment {
  const [time, temperature, group] = [
    newColumn('加热时间', '秒'),
    newColumn('水温', '℃'),
    newColumn('实验阶段', '', 'text'),
  ]
  const record = newExperiment('加热时间与水温', [time, temperature, group])
  const measurements = [
    [0, 20.5, '初始'],
    [30, 23.8, '升温'],
    [60, 27.4, '升温'],
    [90, 32.1, '升温'],
    [120, 35.9, '保温'],
    [150, 39.2, '结束'],
  ] as const
  record.rows = measurements.map(([seconds, degrees, stage]) => ({
    id: crypto.randomUUID(),
    values: { [time.id]: String(seconds), [temperature.id]: String(degrees), [group.id]: stage },
  }))
  return record
}

export function initialWorkspace(): Workspace {
  const record = newExperiment('未命名实验')
  return { version: 1, activeId: record.id, records: [record] }
}

export function loadWorkspace(serialized: string | null): Workspace {
  if (serialized === null) return initialWorkspace()
  const stored = JSON.parse(serialized) as Workspace
  if (stored?.version !== 1 || !Array.isArray(stored.records) || stored.records.length === 0 || !stored.records.every(validRecord)) {
    throw new Error('无法识别保存的数据')
  }
  if (!stored.records.some(record => record.id === stored.activeId)) stored.activeId = stored.records[0].id
  return stored
}

function validRecord(record: Experiment): boolean {
  return Boolean(record && typeof record.id === 'string' && typeof record.name === 'string'
    && Array.isArray(record.columns) && record.columns.length >= 2
    && record.columns.every(column => column && typeof column.id === 'string'
      && typeof column.name === 'string' && typeof column.unit === 'string' && ['number', 'text'].includes(column.kind))
    && Array.isArray(record.rows)
    && record.rows.every(row => row && typeof row.id === 'string' && row.values && typeof row.values === 'object'
      && !Array.isArray(row.values) && Object.values(row.values).every(value => typeof value === 'string'))
    && record.chart && ['line', 'bar', 'scatter'].includes(record.chart.type)
    && typeof record.chart.xId === 'string' && typeof record.chart.yId === 'string'
    && typeof record.chart.title === 'string' && /^#[0-9a-f]{6}$/i.test(record.chart.color))
}

export function columnLabel(column: Column): string {
  return column.unit ? `${column.name}（${column.unit}）` : column.name
}

export function numericValue(raw: string): number | null {
  const value = raw.trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function readCell(row: Row, column: Column): string {
  return row.values[column.id] ?? ''
}

export function isInvalid(raw: string, column: Column): boolean {
  return column.kind === 'number' && raw.trim() !== '' && numericValue(raw) === null
}

export function eligibleColumns(record: Experiment): { x: Column[]; y: Column[] } {
  const numeric = record.columns.filter(column => column.kind === 'number')
  return { x: record.chart.type === 'scatter' ? numeric : record.columns, y: numeric }
}

export function reconcileAxes(record: Experiment): void {
  const { x, y } = eligibleColumns(record)
  if (!x.some(column => column.id === record.chart.xId)) record.chart.xId = x[0]?.id ?? ''
  const otherY = y.filter(column => column.id !== record.chart.xId)
  if (!otherY.some(column => column.id === record.chart.yId)) record.chart.yId = otherY[0]?.id ?? ''
}

function csvField(value: string, numeric = false): string {
  // Neutralize text that spreadsheet apps could interpret as a formula.
  const safeValue = !numeric && /^(?:\s*[=+\-@]|[\t\r\n])/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safeValue) ? `"${safeValue.replaceAll('"', '""')}"` : safeValue
}

export function csvFor(record: Experiment): string {
  const title = record.columns.map(column => csvField(columnLabel(column))).join(',')
  const rows = record.rows.map(row => record.columns.map(column => {
    const value = readCell(row, column)
    return csvField(value, column.kind === 'number' && numericValue(value) !== null)
  }).join(','))
  return '\uFEFF' + [title, ...rows].join('\r\n') + '\r\n'
}

export function fileStem(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim().replace(/\.+$/, '')
  if (!clean) return '实验数据'
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? `_${clean}` : clean
}
