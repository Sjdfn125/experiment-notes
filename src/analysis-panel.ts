import { createChart } from './charts'
import { columnLabel, numericValue, readCell, type Experiment } from './records'
import { empiricalCDF, formatNumber, meanTest, outlierFences, summarize } from './statistics'

export function setupAnalysis(active: () => Experiment, save: () => void) {
  const panel = document.querySelector<HTMLDetailsElement>('#analysis')!
  const columnSelect = panel.querySelector<HTMLSelectElement>('#analysis-column')!
  const nullMean = panel.querySelector<HTMLInputElement>('#null-mean')!
  const alpha = panel.querySelector<HTMLSelectElement>('#test-alpha')!
  const result = panel.querySelector<HTMLOutputElement>('output')!
  const graph = panel.querySelector<HTMLElement>('#distribution')!
  let distribution: ReturnType<typeof createChart> | undefined
  let optionsKey = ''
  let currentSummary = summarize([])

  function renderOutliers(cells: (number | null)[], values: number[], columnId: string, unit: string) {
    const fences = outlierFences(values)
    const list = document.getElementById('outlier-list')!
    const items: HTMLLIElement[] = []
    if (fences) {
      cells.forEach((value, index) => {
        if (value === null || (value >= fences.lower && value <= fences.upper)) return
        const item = document.createElement('li')
        item.textContent = '第 ' + (index + 1) + ' 行 · ' + value + (unit ? ' ' + unit : '')
        items.push(item)
        const row = document.querySelector<HTMLTableSectionElement>('#table-body')!.rows[index]
        const input = row?.querySelector<HTMLInputElement>('[data-column-id="' + CSS.escape(columnId) + '"]')
        if (input) {
          input.dataset.outlier = 'true'
          input.setAttribute('aria-description', '疑似异常值')
        }
      })
    }
    list.replaceChildren(...items)
    list.hidden = items.length === 0
    const bound = (v: number) => Number.isFinite(v) ? formatNumber(v) : (v < 0 ? '−∞' : '+∞')
    document.getElementById('outlier-status')!.textContent = fences
      ? '标记 ' + items.length + ' 项 · 参考区间 [' + bound(fences.lower) + ', ' + bound(fences.upper) + ']' + (unit ? ' ' + unit : '')
      : '至少需要 4 个有效数值。'
  }

  function renderTest() {
    const nullValue = numericValue(nullMean.value)
    if (nullValue === null) {
      result.textContent = nullMean.value.trim() ? '请输入有效的假设均值。' : '输入假设均值后查看检验结果。'
      return
    }
    const test = meanTest(currentSummary, nullValue)
    if (!test) {
      result.textContent = '无法计算 t 检验。至少需要两个有效数值、非零样本方差和可表示的标准误。'
      return
    }
    const probability = test.p < 0.000001 ? 'p < 0.000001' : 'p = ' + formatNumber(test.p)
    const conclusion = test.p <= Number(alpha.value) ? '拒绝原假设' : '证据不足以拒绝原假设'
    result.textContent = 't = ' + formatNumber(test.t) + ' · df = ' + test.df + ' · ' + probability
      + '\n' + conclusion + '（H₀：μ = ' + formatNumber(nullValue) + '）。'
  }

  function refresh() {
    for (const input of document.querySelectorAll<HTMLInputElement>('.table-input[data-outlier]')) {
      delete input.dataset.outlier
      input.removeAttribute('aria-description')
    }
    if (!panel.open) return
    const record = active()
    const columns = record.columns.filter(col => col.kind === 'number')
    const column = columns.find(col => col.id === record.chart.analysisColumn)
      ?? columns.find(col => col.id === record.chart.yId) ?? columns[0]
    const key = JSON.stringify(columns)
    if (key !== optionsKey) {
      columnSelect.replaceChildren(...columns.map(col => new Option(columnLabel(col), col.id)))
      if (!columns.length) columnSelect.append(new Option('无数值列', ''))
      columnSelect.disabled = !columns.length
      optionsKey = key
    }
    columnSelect.value = column?.id ?? ''
    nullMean.value = record.chart.nullMean ?? ''
    alpha.value = record.chart.alpha ?? '0.05'
    const cells = column ? record.rows.map(row => numericValue(readCell(row, column, record.columns))) : []
    const values = cells.filter(v => v !== null)
    currentSummary = summarize(values)
    const { n, mean, variance, sampleVariance } = currentSummary
    const unit = column?.unit ?? ''
    renderOutliers(cells, values, column?.id ?? '', unit)
    const display = (id: string, value: number | null, suffix: string) => {
      const text = formatNumber(value)
      document.getElementById(id)!.textContent = text === '—' || !suffix ? text : text + ' ' + suffix
    }
    display('stat-mean', mean, unit)
    display('stat-var', variance, unit && unit + '²')
    display('stat-svar', sampleVariance, unit && unit + '²')
    document.getElementById('analysis-count')!.textContent = '有效 ' + n + ' 项 · 跳过空值或无效值 ' + (record.rows.length - n) + ' 项'
    const points = empiricalCDF(values)
    distribution ??= createChart(graph)
    distribution.resize()
    distribution.setOption({
      animation: false,
      grid: { top: 16, left: 50, right: 24, bottom: 32 },
      xAxis: { type: 'value', scale: true, axisLabel: { hideOverlap: true } },
      yAxis: { type: 'value', min: 0, max: 1, interval: 0.5,
        axisLabel: { formatter: (p: number) => (p * 100) + '%' }, splitLine: { lineStyle: { color: '#e1eae7' } } },
      tooltip: { trigger: 'axis', renderMode: 'richText' },
      series: [{ type: 'line', name: '累计比例', data: points, step: 'end', symbol: 'none',
        lineStyle: { color: '#087565', width: 2 }, areaStyle: { color: '#ade3d3', opacity: 0.35 } }],
    }, { notMerge: true })
    graph.setAttribute('aria-label', n ? '经验累积分布 · ' + n + ' 个观测值' : '经验累积分布 · 暂无有效值')
    renderTest()
  }

  panel.addEventListener('toggle', refresh)
  columnSelect.addEventListener('change', () => {
    active().chart.analysisColumn = columnSelect.value
    save()
    refresh()
  })
  nullMean.addEventListener('input', () => {
    active().chart.nullMean = nullMean.value
    save()
    renderTest()
  })
  alpha.addEventListener('change', () => {
    active().chart.alpha = alpha.value
    save()
    renderTest()
  })
  new ResizeObserver(() => { if (panel.open) distribution?.resize() }).observe(graph)
  return { refresh }
}
