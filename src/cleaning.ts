import { isInvalid, numericValue, type Experiment, type Row } from './records'

export interface CleaningOptions {
  trim: boolean
  numbers: boolean
  emptyRows: boolean
  duplicates: boolean
  clearInvalid: boolean
}

function normalizeNumber(raw: string) {
  let candidate = raw.trim().replace(/[０-９．＋－，Ｅｅ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/−/g, '-')
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?([eE][+-]?\d+)?$/.test(candidate)) candidate = candidate.replaceAll(',', '')
  return numericValue(candidate) === null ? raw : candidate
}

export function cleanRows(record: Experiment, options: CleaningOptions) {
  const sources = record.columns.filter(column => !column.formula)
  const seen = new Set<string>(), rows: Row[] = [], examples: string[] = []
  let edited = 0, removed = 0, invalid = 0
  const report = (text: string) => { if (examples.length < 8) examples.push(text) }
  for (const [index, row] of record.rows.entries()) {
    const values = { ...row.values }
    const issues: string[] = []
    for (const column of sources) {
      const raw = values[column.id] ?? ''
      let value = options.trim ? raw.trim() : raw
      if (column.kind === 'number' && options.numbers) value = normalizeNumber(value)
      if (isInvalid(value, column)) {
        if (options.clearInvalid) value = ''
        else {
          issues.push('第 ' + (index + 1) + ' 行 · ' + column.name + '：待核对「' + value + '」')
        }
      }
      if (value !== raw) {
        edited++
        values[column.id] = value
        report('第 ' + (index + 1) + ' 行 · ' + column.name + '：「' + raw + '」 → ' + (value ? '「' + value + '」' : '空值'))
      }
    }
    const fields = sources.map(col => values[col.id] ?? '')
    const key = JSON.stringify(fields)
    const blank = fields.every(value => !value.trim())
    if ((options.emptyRows && blank) || (options.duplicates && seen.has(key))) {
      removed++
      report('第 ' + (index + 1) + ' 行：移除' + (blank ? '空行' : '完全重复行'))
      continue
    }
    seen.add(key)
    invalid += issues.length
    issues.forEach(report)
    rows.push({ id: row.id, values })
  }
  return { rows, edited, removed, invalid, examples }
}
