import { init, use, type EChartsCoreOption } from 'echarts/core'
import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import { GridComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { columnLabel, numericValue, readCell, type Experiment } from './records'

use([BarChart, LineChart, ScatterChart, GridComponent, TitleComponent, TooltipComponent, CanvasRenderer])

export function createChart(container: HTMLElement) {
  return init(container, undefined, { renderer: 'canvas' })
}

export function chartTitle(record: Experiment): string {
  return record.chart.title.trim() || record.name
}

export function plotFor(record: Experiment, width: number): { option?: EChartsCoreOption; count: number; skipped: number } {
  const config = record.chart
  const x = record.columns.find(column => column.id === config.xId)
  const y = record.columns.find(column => column.id === config.yId)
  if (!x || !y) return { count: 0, skipped: 0 }

  const category = x.kind === 'text' || config.type === 'bar'
  const points: [number | string, number][] = []
  let skipped = 0
  for (const row of record.rows) {
    const rawX = readCell(row, x).trim()
    const rawY = readCell(row, y).trim()
    const xValue = x.kind === 'number' ? numericValue(rawX) : (rawX || null)
    const yValue = numericValue(rawY)
    if (xValue === null || yValue === null) {
      if (rawX || rawY) skipped++
      continue
    }
    points.push([xValue, yValue])
  }
  if (!points.length) return { count: 0, skipped }

  if (config.type === 'line' && !category) points.sort(([first], [second]) => Number(first) - Number(second))

  return {
    count: points.length,
    skipped,
    option: {
      animation: false,
      backgroundColor: '#ffffff',
      title: {
        text: chartTitle(record),
        left: 'center',
        top: 16,
        textStyle: { color: '#142f33', fontSize: 16, width: Math.max(140, width - 36), overflow: 'truncate' },
      },
      grid: { left: 72, right: 26, top: 62, bottom: 72 },
      tooltip: { trigger: config.type === 'scatter' ? 'item' : 'axis', renderMode: 'richText' },
      xAxis: {
        type: category ? 'category' : 'value',
        name: columnLabel(x),
        nameLocation: 'middle',
        nameGap: 39,
        nameTextStyle: { color: '#355558', width: Math.max(100, width - 112), overflow: 'truncate' },
        axisLabel: { color: '#52696a', hideOverlap: true, width: 80, overflow: 'truncate' },
        ...(category ? { data: points.map(([label]) => String(label)) } : { scale: true }),
      },
      yAxis: {
        type: 'value',
        name: columnLabel(y),
        nameLocation: 'middle',
        nameGap: 46,
        nameTextStyle: { color: '#355558', width: 175, overflow: 'truncate' },
        axisLabel: { color: '#52696a', hideOverlap: true, width: 37, overflow: 'truncate' },
        splitLine: { lineStyle: { color: '#e3eceb', type: 'dashed' } },
        scale: config.type !== 'bar',
      },
      series: [{
        name: columnLabel(y),
        type: config.type,
        data: category ? points.map(([, value]) => value) : points,
        symbol: 'circle',
        symbolSize: config.type === 'scatter' ? 10 : 8,
        barMaxWidth: 48,
        itemStyle: { color: config.color, opacity: 1 },
        lineStyle: { color: config.color, width: 3 },
      }],
    },
  }
}
