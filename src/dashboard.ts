import { createChart } from './charts'
import { formatNumber, summarize } from './statistics'
import { columnLabel, readCell, numericValue, type Experiment } from './records'

export function setupDashboard(active: () => Experiment) {
  const panel = document.querySelector<HTMLDetailsElement>('#dashboard')!
  const metric = panel.querySelector<HTMLSelectElement>('#dash-metric')!
  const range = panel.querySelector<HTMLSelectElement>('#dash-range')!
  const profile = document.getElementById('dash-profile')!, histogram = document.getElementById('dash-histogram')!
  let rowChart: ReturnType<typeof createChart> | undefined
  let binChart: ReturnType<typeof createChart> | undefined
  let previousRecord = '', metricKey = '', binKey = ''
  let membership: number[] = []

  function selectBin(index: number) {
    if (index < 0 || !Number.isInteger(index)) return
    range.value = range.value === String(index) ? '' : String(index)
    refresh()
  }

  function refresh() {
    if (!panel.open) return
    const record = active(), numeric = record.columns.filter(c => c.kind === 'number')
    const nextMetricKey = JSON.stringify([record.id, numeric])
    if (nextMetricKey !== metricKey) {
      const preferred = previousRecord === record.id ? metric.value : record.chart.yId
      metric.replaceChildren(...numeric.map(c => new Option(columnLabel(c), c.id)))
      metric.value = numeric.find(c => c.id === preferred)?.id ?? numeric[0]?.id ?? ''
      metricKey = nextMetricKey
      previousRecord = record.id
    }
    metric.disabled = !numeric.length
    const column = numeric.find(c => c.id === metric.value)
    const items = column ? record.rows.map((row, i) => ({ row: i + 1, value: numericValue(readCell(row, column, record.columns)) }))
      .filter((item): item is {row:number; value:number} => item.value !== null) : []
    let min = Infinity, max = -Infinity
    for (const item of items) { min = Math.min(min, item.value); max = Math.max(max, item.value) }
    const binCount = max === min ? 1 : Math.min(10, Math.ceil(Math.sqrt(items.length)))
    const bins = Array<number>(binCount).fill(0)
    const scale = Math.max(Math.abs(min), Math.abs(max)) || 1
    const span = max - min
    membership = items.map(({value}) => {
      const fraction = Number.isFinite(span) ? (value - min) / span : (value / scale - min / scale) / (max / scale - min / scale)
      const bin = binCount === 1 ? 0 : Math.min(binCount - 1, Math.max(0, Math.floor(fraction * binCount)))
      bins[bin]++
      return bin
    })
    const edge = (i: number) => formatNumber(min * (1 - i / binCount) + max * (i / binCount))
    const labels = bins.map((_, i) => binCount === 1 ? formatNumber(min)
      : '[' + edge(i) + ', ' + edge(i + 1) + (i === binCount - 1 ? ']' : ')'))
    const nextBinKey = JSON.stringify([record.id, metric.value, min, max, binCount])
    if (nextBinKey !== binKey) {
      range.replaceChildren(new Option('全部区间', ''), ...labels.map((label, i) => new Option(label, String(i))))
      binKey = nextBinKey
    }
    range.disabled = !items.length
    const selected = range.value === '' ? null : Number(range.value)
    const included = (i: number) => selected === null || membership[i] === selected
    const values = items.filter((_, i) => included(i)).map(item => item.value)
    const status = items.length ? '选中 ' + values.length + ' / ' + items.length + ' 项 · 均值 ' + formatNumber(summarize(values).mean) + (column?.unit ? ' ' + column.unit : '')
      : '所选列暂无有效数值。'
    document.getElementById('dash-status')!.textContent = status
    if (!rowChart || !binChart) {
      rowChart = createChart(profile)
      binChart = createChart(histogram)
      rowChart.on('click', event => selectBin(membership[event.dataIndex]))
      binChart.on('click', event => selectBin(event.dataIndex))
    }
    const common = { animation: false, grid: {top: 16, bottom: 48, left: 52, right: 18},
      tooltip: {trigger:'axis',renderMode:'richText'}, yAxis: {type:'value', splitLine:{lineStyle:{color:'#e1eae7'}}} }
    rowChart.setOption({...common,
      yAxis: {...common.yAxis, scale:true},
      xAxis: {type:'category', data:items.map(item => String(item.row)), name:'表格行号', nameLocation:'middle',nameGap:27},
      series: [{name: column?.name, type:'line', symbol:'circle', symbolSize:8, itemStyle:{color:'#087565'},
        data:items.map((item,i) => included(i) ? item.value : null)}]}, true)
    binChart.setOption({...common,
      xAxis:{type:'category', data:labels, axisLabel:{hideOverlap:true}},
      yAxis:{...common.yAxis, minInterval:1},
      series:[{name:'观测数', type:'bar', barMaxWidth:65, data:bins.map((count,i) => ({value:count,
        itemStyle:{color:selected === null || i === selected ? '#087565' : '#cddeda'}}))}]},true)
    profile.setAttribute('aria-label','按行测量图，选中 ' + values.length + ' 项')
    histogram.setAttribute('aria-label','频数图，共 ' + bins.length + ' 个区间')
  }
  panel.addEventListener('toggle',refresh)
  metric.addEventListener('change',refresh)
  range.addEventListener('change',refresh)
  new ResizeObserver(() => {
    if (panel.open) { rowChart?.resize(); binChart?.resize() }
  }).observe(profile)
  return { refresh }
}
