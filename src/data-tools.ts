import { cleanRows } from './cleaning'
import { recommend } from './recommend'
import { columnLabel, newColumn, numericValue, readCell, type Experiment, type Operation } from './records'

const typeNames = { line: '折线图', bar: '柱状图', scatter: '散点图' }

export function setupDataTools(active: () => Experiment, changed: () => void, addRecord: (record: Experiment) => void) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const formula = get<HTMLDialogElement>('formula-dialog')
  const form = get<HTMLFormElement>('formula-form')
  const left = get<HTMLSelectElement>('formula-left'), right = get<HTMLSelectElement>('formula-right')
  const op = get<HTMLSelectElement>('formula-op'), constant = get<HTMLInputElement>('formula-constant')
  const name = get<HTMLInputElement>('formula-name'), unit = get<HTMLInputElement>('formula-unit')
  const clean = get<HTMLDialogElement>('clean-dialog'), suggest = get<HTMLDialogElement>('suggest-dialog')
  for (const dialog of [formula, clean, suggest]) {
    dialog.querySelector('[data-cancel]')!.addEventListener('click', () => dialog.close())
  }
  function makeColumn() {
    const record = active()
    const operand = right.value === '' ? numericValue(constant.value) : right.value
    if (!left.value || operand === null) return null
    const column = newColumn(name.value.trim(), unit.value.trim())
    column.formula = {left:left.value, op:op.value as Operation, right:operand}
    return {column, columns:[...record.columns,column]}
  }
  function previewFormula() {
    get('constant-label').hidden = right.value !== ''
    const spec = makeColumn(), record = active()
    get<HTMLButtonElement>('formula-apply').disabled = !spec || !name.value.trim()
    if (!spec) {
      get('formula-preview').textContent = left.value ? '请输入有效的数值常数。' : '请先添加一个数值列。'
      return
    }
    const first = record.rows[0]
    const value = first && readCell(first, spec.column, spec.columns)
    get('formula-preview').textContent = '首行预览：' + (value || '—') + '。缺少有效输入或除以零时，结果留空。'
  }
  get('formula-open').addEventListener('click', () => {
    form.reset()
    const options = () => active().columns.filter(c => c.kind === 'number').map(c => new Option(columnLabel(c),c.id))
    left.replaceChildren(...options())
    right.replaceChildren(new Option('常数',''), ...options())
    previewFormula()
    formula.showModal()
    name.focus()
  })
  form.addEventListener('input', previewFormula)
  form.addEventListener('submit', event => {
    event.preventDefault()
    const spec = makeColumn()
    if (!spec || !name.value.trim()) return
    active().columns.push(spec.column)
    formula.close()
    changed()
  })

  const checked = (key: string) => clean.querySelector<HTMLInputElement>('input[name="' + key + '"]')!.checked
  const cleaning = () => cleanRows(active(), {trim:checked('trim'), numbers:checked('numbers'),
    emptyRows:checked('emptyRows'), duplicates:checked('duplicates'), clearInvalid:checked('clearInvalid')})
  function previewCleaning() {
    const result = cleaning()
    get('clean-count').textContent = '调整 ' + result.edited + ' 格 · 移除 ' + result.removed + ' 行 · 待核对 ' + result.invalid + ' 格'
    get('clean-preview').replaceChildren(...result.examples.map(example => {
      const item = document.createElement('li')
      item.textContent = example
      return item
    }))
    get<HTMLButtonElement>('clean-apply').disabled = !(result.edited || result.removed)
  }
  get('clean-open').addEventListener('click', () => {
    previewCleaning()
    clean.showModal()
  })
  clean.addEventListener('change', previewCleaning)
  get('clean-apply').addEventListener('click', () => {
    const result = cleaning()
    if (!result.edited && !result.removed) return
    const copy = structuredClone(active())
    copy.id = crypto.randomUUID()
    copy.name += '（清洗）'
    copy.rows = result.rows
    clean.close()
    addRecord(copy)
  })

  get('suggest-open').addEventListener('click', () => {
    const record = active(), suggestions = recommend(record)
    const list = get('suggest-list')
    list.replaceChildren()
    for (const item of suggestions) {
      const block = document.createElement('div')
      const title = document.createElement('strong')
      title.textContent = typeNames[item.type] + ' · ' + item.y.name
      const detail = document.createElement('p')
      detail.className = 'stat-hint'
      detail.textContent = 'X：' + columnLabel(item.x) + '　Y：' + columnLabel(item.y) + '　有效配对 ' + item.count + ' 行'
      const reason = document.createElement('p')
      reason.className = 'stat-hint'
      reason.textContent = {line:'沿时间或进程观察变化。',bar:'按类别比较测量值。',scatter:'观察两列数值的关系。'}[item.type]
      const button = document.createElement('button')
      button.className = 'button'
      button.textContent = '应用' + typeNames[item.type]
      button.addEventListener('click', () => {
        Object.assign(record.chart,{type:item.type,xId:item.x.id,yId:item.y.id})
        suggest.close()
        changed()
      })
      block.append(title,detail,reason,button)
      list.append(block)
    }
    if (!suggestions.length) list.textContent = '暂无合适推荐。请准备不同的 X 值、一列数值 Y，以及至少两行有效配对数据。'
    suggest.showModal()
  })
}
