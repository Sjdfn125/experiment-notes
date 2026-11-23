import { reconcileAxes, validFormulas, type Workspace, type Experiment } from './records'

type Item = { id: string }
type Resolve = (label: string, local: unknown, remote: unknown) => boolean

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Arrays in the storage schema contain records, columns or rows, all with stable IDs.
function objectFields(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mergeValue(base: unknown, local: unknown, remote: unknown, path: string, resolve: Resolve): unknown {
  if (same(base, local)) return remote
  if (same(base, remote) || same(local, remote)) return local
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const index = (items: Item[]) => new Map(items.map(item => [item.id, item]))
    const before = index(base), ours = index(local), theirs = index(remote)
    const ids = new Set([...theirs.keys(), ...ours.keys()])
    return Array.from(ids, id => mergeValue(before.get(id), ours.get(id), theirs.get(id), path + '/' + id, resolve))
      .filter(item => item !== undefined)
  }
  if (objectFields(base) && objectFields(local) && objectFields(remote)) {
    const result: Record<string, unknown> = Object.create(null)
    for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeValue(base[key], local[key], remote[key], path + '/' + key, resolve)
      if (value !== undefined) result[key] = value
    }
    return result
  }
  return resolve(path, local, remote) ? local : remote
}

function changedDeletedColumn(base: Experiment, deletedFrom: Experiment, other: Experiment): boolean {
  for (const column of base.columns) {
    if (deletedFrom.columns.some(c => c.id === column.id)) continue
    if (!other.columns.some(c => c.id === column.id)) continue
    const original = new Map(base.rows.map(row => [row.id, row.values[column.id]]))
    if (other.rows.some(row => row.values[column.id] !== original.get(row.id))) return true
  }
  return false
}

export function mergeWorkspace(base: Workspace, local: Workspace, remote: Workspace, resolve: Resolve): Workspace {
  const records = new Map(remote.records.map(record => [record.id, record]))
  const originals = new Map(base.records.map(record => [record.id, record]))
  for (const record of local.records) {
    const original = originals.get(record.id)
    const latest = records.get(record.id)
    if (same(original, record)) continue
    if (!latest || !original || same(original, latest)) {
      records.set(record.id, structuredClone(record))
      continue
    }
    const resolveField: Resolve = (path, ours, theirs) => {
      const parts = path.split('/')
      const rowIndex = record.rows.findIndex(row => row.id === parts[2])
      const column = record.columns.find(col => col.id === parts.at(-1))
      const field = parts[1] === 'rows' && rowIndex >= 0 && column
        ? '第 ' + (rowIndex + 1) + ' 行 · ' + column.name : path
      return resolve(record.name + ' / ' + field, ours, theirs)
    }
    let merged = mergeValue(original, record, latest, '', resolveField) as Experiment
    if (merged.columns.length < 2 || !validFormulas(merged.columns) || changedDeletedColumn(original, record, latest) || changedDeletedColumn(original, latest, record)) {
      merged = resolve(record.name + ' 的列结构与数据冲突，选择保留的整份记录', record, latest) ? record : latest
    }
    records.set(record.id, structuredClone(merged))
  }
  const mergedRecords = Array.from(records.values())
  for (const record of mergedRecords) reconcileAxes(record)
  const selected = base.activeId === local.activeId ? remote.activeId : local.activeId
  return { version: 1, records: mergedRecords, activeId: records.has(selected) ? selected : mergedRecords[0].id }
}
