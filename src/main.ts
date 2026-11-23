import './styles.css'
import { mergeWorkspace } from './merge'
import { setupAnalysis } from './analysis-panel'
import { setupDataTools } from './data-tools'
import { setupDashboard } from './dashboard'
import { chartTitle, createChart, plotFor } from './charts'
import {
  STORAGE_KEY, columnLabel, csvFor, dependsOn, eligibleColumns, fileStem, initialWorkspace, isInvalid,
  loadWorkspace, newColumn, newExperiment, newRow, newSample, readCell, reconcileAxes,
  type ChartType, type Column, type Workspace,
} from './records'

function get<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

const saveStatus = get('save-status')
const recordList = get<HTMLUListElement>('record-list')
const tableHead = get<HTMLTableSectionElement>('table-head')
const tableBody = get<HTMLTableSectionElement>('table-body')
const xAxis = get<HTMLSelectElement>('x-axis')
const yAxis = get<HTMLSelectElement>('y-axis')
const titleInput = get<HTMLInputElement>('chart-title')
const colorInput = get<HTMLInputElement>('chart-color')
const chartContainer = get('chart')
const chartEmpty = get('chart-empty')
const pngButton = get<HTMLButtonElement>('export-png')
const recordDialog = get<HTMLDialogElement>('record-dialog')
const columnDialog = get<HTMLDialogElement>('column-dialog')
const recordName = get<HTMLInputElement>('record-name')
const columnName = get<HTMLInputElement>('column-name')
const columnUnit = get<HTMLInputElement>('column-unit')
const columnKind = get<HTMLSelectElement>('column-kind')
const removeColumnButton = get<HTMLButtonElement>('remove-column')
const typeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-chart-type]'))
const typeNames: Record<ChartType, string> = { line: '折线图', bar: '柱状图', scatter: '散点图' }

let workspace: Workspace
let holdSavedData = false
try {
  workspace = loadWorkspace(localStorage.getItem(STORAGE_KEY))
} catch {
  workspace = initialWorkspace()
  holdSavedData = true
}

const chart = createChart(chartContainer)
const analysis = setupAnalysis(active, save)
const dashboard = setupDashboard(active)
let lastLocal = structuredClone(workspace)
let saveQueued = false
let editingColumn: Column | undefined
let renaming = false
let scheduledChart = 0

function active() {
  return workspace.records.find(record => record.id === workspace.activeId)!
}

function save(): void {
  if (holdSavedData || !navigator.locks) {
    saveStatus.textContent = holdSavedData ? '本机数据读取失败 · 当前更改仅本次有效' : '当前环境无法安全保存 · 请导出数据'
    saveStatus.classList.add('unsaved')
    return
  }
  if (saveQueued) return
  saveQueued = true
  saveStatus.textContent = '正在保存'
  void navigator.locks.request(STORAGE_KEY, () => {
    const raw = localStorage.getItem(STORAGE_KEY)
    let conflict = false
    const merged = raw === null ? workspace : mergeWorkspace(lastLocal, workspace, loadWorkspace(raw), (field, ours, theirs) => {
      conflict = true
      const preview = (value: unknown) => typeof value === 'object' ? JSON.stringify(value).slice(0, 180) : String(value ?? '已删除')
      return window.confirm(field + '\n两个页面均有修改。\n确定保留本页：' + preview(ours) + '\n取消保留已保存版本：' + preview(theirs))
    })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    if (conflict || !merged.records.some(record => record.id === workspace.activeId)) {
      const currentId = workspace.activeId
      workspace = structuredClone(merged)
      if (workspace.records.some(record => record.id === currentId)) workspace.activeId = currentId
      renderWorkspace()
    }
    // Keep the base that this editor actually saw, so stale cells can raise a conflict.
    lastLocal = structuredClone(workspace)
    saveStatus.textContent = '已保存到本机'
    saveStatus.classList.remove('unsaved')
  }).catch(() => {
    saveStatus.textContent = '保存失败 · 请及时导出'
    saveStatus.classList.add('unsaved')
  }).finally(() => { saveQueued = false })
}

window.addEventListener('beforeunload', event => { if (saveQueued) event.preventDefault() })

function renderRecords(): void {
  const items = workspace.records.map(record => {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'record-link'
    button.textContent = record.name
    button.title = record.name
    if (record.id === workspace.activeId) button.setAttribute('aria-current', 'true')
    button.addEventListener('click', () => {
      if (workspace.activeId === record.id) return
      workspace.activeId = record.id
      save()
      renderWorkspace()
      recordList.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus()
    })
    item.append(button)
    return item
  })
  recordList.replaceChildren(...items)
}

function renderSummary(): void {
  const record = active()
  get('record-summary').textContent = `${record.rows.length} 行数据 · ${record.columns.length} 列`
}

function renderTable(): void {
  const record = active()
  const head = document.createElement('tr')
  const indexHead = document.createElement('th')
  indexHead.scope = 'col'
  indexHead.className = 'row-number'
  indexHead.textContent = '行'
  head.append(indexHead)
  for (const column of record.columns) {
    const cell = document.createElement('th')
    cell.scope = 'col'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'column-button'
    button.textContent = columnLabel(column)
    button.setAttribute('aria-label', `编辑列 ${columnLabel(column)}`)
    button.title = `${columnLabel(column)} · ${column.kind === 'number' ? '数值' : '文本'}`
    button.addEventListener('click', () => openColumnDialog(column))
    cell.append(button)
    head.append(cell)
  }
  const actions = document.createElement('th')
  actions.scope = 'col'
  actions.className = 'row-action'
  actions.setAttribute('aria-label', '行操作')
  head.append(actions)
  tableHead.replaceChildren(head)

  const rows = record.rows.map((row, index) => {
    const line = document.createElement('tr')
    const number = document.createElement('th')
    number.scope = 'row'
    number.className = 'row-number'
    number.textContent = String(index + 1)
    line.append(number)
    const derivedInputs = new Map<Column, HTMLInputElement>()
    for (const column of record.columns) {
      const cell = document.createElement('td')
      const input = document.createElement('input')
      input.className = 'table-input'
      input.inputMode = column.kind === 'number' ? 'decimal' : 'text'
      input.setAttribute('aria-label', `第 ${index + 1} 行 ${columnLabel(column)}`)
      input.autocomplete = 'off'
      input.value = readCell(row, column, record.columns)
      if (column.formula) {
        derivedInputs.set(column, input)
        input.readOnly = true
        input.placeholder = '—'
      }
      showValidation(input, column)
      input.addEventListener('input', () => {
        row.values[column.id] = input.value
        for (const [derived, field] of derivedInputs) field.value = readCell(row, derived, record.columns)
        showValidation(input, column)
        save()
        scheduleChart()
      })
      cell.append(input)
      line.append(cell)
    }
    const action = document.createElement('td')
    action.className = 'row-action'
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'icon-button row-remove'
    remove.textContent = '×'
    remove.title = `删除第 ${index + 1} 行`
    remove.setAttribute('aria-label', remove.title)
    remove.addEventListener('click', () => {
      if (Object.values(row.values).some(value => value.trim()) && !window.confirm(`删除第 ${index + 1} 行及其中的数据？`)) return
      record.rows = record.rows.filter(candidate => candidate.id !== row.id)
      save()
      renderTable()
      renderSummary()
      scheduleChart()
      tableBody.querySelectorAll<HTMLButtonElement>('.row-remove')[Math.min(index, record.rows.length - 1)]?.focus()
      if (!record.rows.length) get('add-row').focus()
    })
    action.append(remove)
    line.append(action)
    return line
  })
  tableBody.replaceChildren(...rows)
  if (!rows.length) {
    const message = tableBody.insertRow().insertCell()
    message.colSpan = record.columns.length + 2
    message.className = 'table-empty'
    message.textContent = '暂无数据，点击「新增行」开始录入。'
  }
}

function showValidation(input: HTMLInputElement, column: Column): void {
  const invalid = isInvalid(input.value, column)
  input.setAttribute('aria-invalid', String(invalid))
  input.title = invalid ? '请输入有效数字，如 0、-2 或 3.5' : ''
}

function fillAxis(select: HTMLSelectElement, columns: Column[], selected: string): void {
  select.replaceChildren(...columns.map(column => new Option(columnLabel(column), column.id)))
  if (!columns.length) select.append(new Option('无可用列', ''))
  select.value = selected
  select.disabled = columns.length === 0
}

function renderChartSettings(): void {
  const record = active()
  const { x, y } = eligibleColumns(record)
  for (const button of typeButtons) button.setAttribute('aria-pressed', String(button.dataset.chartType === record.chart.type))
  fillAxis(xAxis, x, record.chart.xId)
  fillAxis(yAxis, y.filter(column => column.id !== record.chart.xId), record.chart.yId)
  titleInput.value = record.chart.title
  colorInput.value = record.chart.color
  get('trend-control').hidden = record.chart.type !== 'scatter'
  get<HTMLInputElement>('trend-line').checked = Boolean(record.chart.trend)
}

function renderChart(): void {
  const record = active()
  const { option, count, skipped, trendNote } = plotFor(record, chart.getWidth())
  get('trend-note').textContent = trendNote ?? ''
  analysis.refresh()
  dashboard.refresh()
  chartEmpty.hidden = Boolean(option)
  chartContainer.setAttribute('aria-hidden', String(!option))
  chartContainer.setAttribute('aria-label', `${chartTitle(record)} · ${typeNames[record.chart.type]} · ${count} 个点`)
  pngButton.disabled = !option
  if (option) {
    chart.setOption(option, { notMerge: true })
  } else {
    chart.clear()
    chartEmpty.textContent = !record.chart.xId || !record.chart.yId
      ? '请为 X 轴和 Y 轴选择符合图表类型的列。'
      : '在表格中录入一组有效的 X、Y 数据，图表会显示在这里。'
  }
  const skippedMessage = skipped ? ` · ${skipped} 行缺少有效的坐标数据` : ''
  const chartStatus = get('chart-status')
  const status = `已绘制 ${count} 个点${skippedMessage}`
  if (chartStatus.textContent !== status) chartStatus.textContent = status
}

function scheduleChart(): void {
  if (scheduledChart) return
  scheduledChart = requestAnimationFrame(() => {
    scheduledChart = 0
    renderChart()
  })
}

function renderWorkspace(): void {
  const record = active()
  reconcileAxes(record)
  get('record-title').textContent = record.name
  renderRecords()
  renderSummary()
  renderTable()
  renderChartSettings()
  scheduleChart()
}

function openRecordDialog(rename: boolean): void {
  renaming = rename
  get('record-dialog-title').textContent = rename ? '重命名记录' : '新建记录'
  recordName.value = rename ? active().name : ''
  recordName.setCustomValidity('')
  recordDialog.showModal()
  recordName.select()
}

function openColumnDialog(column?: Column): void {
  editingColumn = column
  get('column-dialog-title').textContent = column ? '编辑数据列' : '新增数据列'
  columnName.value = column?.name ?? ''
  columnName.setCustomValidity('')
  columnUnit.value = column?.unit ?? ''
  columnKind.value = column?.kind ?? 'number'
  const dependent = column && active().columns.find(c => dependsOn(c, column.id))
  columnKind.disabled = Boolean(column?.formula || dependent)
  const note = get('column-note')
  note.textContent = dependent ? '「' + dependent.name + '」使用此列。' : ''
  if (column?.formula) {
    const ref = (id: string) => active().columns.find(c => c.id === id)?.name ?? '缺失列'
    const { left, op, right } = column.formula
    note.textContent += ' 公式：' + ref(left) + ' ' + op + ' ' + (typeof right === 'number' ? right : ref(right))
  }
  note.hidden = !note.textContent
  removeColumnButton.hidden = !column
  removeColumnButton.disabled = active().columns.length <= 2 || Boolean(dependent)
  removeColumnButton.title = dependent ? '先移除引用此列的公式' : removeColumnButton.disabled ? '至少保留两列' : ''
  columnDialog.showModal()
  columnName.select()
}

function valueOrPrompt(input: HTMLInputElement): string {
  const value = input.value.trim()
  if (!value) {
    input.setCustomValidity('请输入名称')
    input.reportValidity()
  }
  return value
}

function addRecord(record: ReturnType<typeof newExperiment>): void {
  workspace.records.push(record)
  workspace.activeId = record.id
  save()
  renderWorkspace()
}

function chartSettingsChanged(): void {
  reconcileAxes(active())
  save()
  renderChartSettings()
  scheduleChart()
}

function download(url: string, filename: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
}

get('new-record').addEventListener('click', () => openRecordDialog(false))
setupDataTools(active, () => { save(); renderWorkspace() }, addRecord)
get('rename-record').addEventListener('click', () => openRecordDialog(true))
get('sample-record').addEventListener('click', () => addRecord(newSample()))
get('add-column').addEventListener('click', () => openColumnDialog())
get('add-row').addEventListener('click', () => {
  active().rows.push(newRow())
  save()
  renderSummary()
  renderTable()
  tableBody.lastElementChild?.querySelector('input')?.focus()
})

for (const [dialog, input] of [[recordDialog, recordName], [columnDialog, columnName]] as const) {
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close())
  input.addEventListener('input', () => input.setCustomValidity(''))
}

get('record-form').addEventListener('submit', event => {
  event.preventDefault()
  const name = valueOrPrompt(recordName)
  if (!name) return
  recordDialog.close()
  if (renaming) {
    active().name = name
    save()
    renderWorkspace()
  } else {
    addRecord(newExperiment(name))
  }
})

get('column-form').addEventListener('submit', event => {
  event.preventDefault()
  const name = valueOrPrompt(columnName)
  if (!name) return
  const unit = columnUnit.value.trim()
  const kind = columnKind.value === 'text' ? 'text' : 'number'
  const column = editingColumn ?? newColumn(name, unit, kind)
  if (editingColumn) {
    Object.assign(column, { name, unit, kind })
  } else {
    active().columns.push(column)
  }
  columnDialog.close()
  reconcileAxes(active())
  save()
  renderWorkspace()
  tableHead.querySelectorAll<HTMLButtonElement>('.column-button')[active().columns.indexOf(column)]?.focus()
})

removeColumnButton.addEventListener('click', () => {
  const record = active()
  const column = editingColumn
  if (!column || record.columns.length <= 2 || record.columns.some(c => dependsOn(c, column.id))
    || !window.confirm(`删除「${column.name}」列及其中的数据？`)) return
  record.columns = record.columns.filter(candidate => candidate.id !== column.id)
  for (const row of record.rows) delete row.values[column.id]
  columnDialog.close()
  reconcileAxes(record)
  save()
  renderWorkspace()
  get('add-column').focus()
})

for (const button of typeButtons) {
  button.addEventListener('click', () => {
    active().chart.type = button.dataset.chartType as ChartType
    chartSettingsChanged()
  })
}
xAxis.addEventListener('change', () => {
  active().chart.xId = xAxis.value
  chartSettingsChanged()
})
yAxis.addEventListener('change', () => {
  active().chart.yId = yAxis.value
  chartSettingsChanged()
})
titleInput.addEventListener('input', () => {
  active().chart.title = titleInput.value
  save()
  scheduleChart()
})
colorInput.addEventListener('input', () => {
  active().chart.color = colorInput.value
  save()
  scheduleChart()
})
get<HTMLInputElement>('trend-line').addEventListener('change', event => {
  active().chart.trend = (event.target as HTMLInputElement).checked
  save()
  scheduleChart()
})
get('export-csv').addEventListener('click', () => {
  const record = active()
  const url = URL.createObjectURL(new Blob([csvFor(record)], { type: 'text/csv;charset=utf-8' }))
  download(url, `${fileStem(record.name)}.csv`)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
})
pngButton.addEventListener('click', () => {
  renderChart()
  if (!pngButton.disabled) {
    download(chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' }), `${fileStem(chartTitle(active()))}.png`)
  }
})

new ResizeObserver(() => {
  chart.resize()
  scheduleChart()
}).observe(chartContainer)

renderWorkspace()
save()
