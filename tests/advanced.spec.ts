import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { cleanRows } from '../src/cleaning'
import { newColumn, newExperiment, newSample, readCell, validFormulas } from '../src/records'
import { recommend } from '../src/recommend'

test('cleaning preserves ambiguous input; formulas handle chains, division and invalid references', () => {
  const record = newExperiment('示例')
  const [a,b] = record.columns
  const row = record.rows[0]
  row.values = {[a.id]:' １２，３４５ ',[b.id]:'1,23'}
  const options = {trim:true,numbers:true,emptyRows:true,duplicates:true,clearInvalid:false}
  const result = cleanRows(record,options)
  expect(result.rows).toHaveLength(1)
  expect(result.rows[0].values).toEqual({[a.id]:'12345',[b.id]:'1,23'})
  expect(result.invalid).toBe(1)
  expect(row.values[a.id]).toBe(' １２，３４５ ')
  const c = newColumn('比值'), d = newColumn('双倍')
  c.formula = {left:a.id,op:'/',right:b.id}
  d.formula = {left:c.id,op:'*',right:2}
  record.columns.push(c,d)
  row.values[a.id] = '6'
  row.values[b.id] = '3'
  expect(readCell(row,d,record.columns)).toBe('4')
  row.values[b.id] = '0'
  expect(readCell(row,d,record.columns)).toBe('')
  c.formula.left = d.id
  expect(validFormulas(record.columns)).toBe(false)
  expect(readCell(row,d,record.columns)).toBe('')
  expect(recommend(newExperiment('空记录'))).toEqual([])
  expect(recommend(newSample()).map(item => item.type)).toEqual(expect.arrayContaining(['line','bar']))
  const pairs = newExperiment('数值配对',[newColumn('质量'),newColumn('体积')])
  pairs.rows.forEach((item,i) => { item.values = {[pairs.columns[0].id]:String(i),[pairs.columns[1].id]:String(i*2)} })
  expect(recommend(pairs)[0].type).toBe('scatter')
})

test('preview cleaning and preserve original while creating a reusable copy', async ({page}) => {
  await page.goto('/')
  await page.getByLabel('第 1 行 时间（秒）').fill(' １，２００ ')
  await page.getByLabel('第 1 行 测量值').fill('2')
  await page.getByLabel('第 2 行 时间（秒）').fill('1200')
  await page.getByLabel('第 2 行 测量值').fill('2')
  await page.getByRole('button',{name:'清洗数据'}).click()
  await page.getByLabel('合并完全重复行，保留首行').check()
  await expect(page.locator('#clean-count')).toContainText('移除 2 行')
  await page.getByRole('button',{name:'保存为清洗副本'}).click()
  await expect(page.getByRole('heading',{name:'未命名实验（清洗）'})).toBeVisible()
  await expect(page.getByLabel('第 1 行 时间（秒）')).toHaveValue('1200')
  await expect(page.locator('#record-summary')).toHaveText('1 行数据 · 2 列')
  await page.getByRole('button',{name:'未命名实验',exact:true}).click()
  await expect(page.getByLabel('第 1 行 时间（秒）')).toHaveValue(' １，２００ ')
})

test('derived values update the table, chart, statistics and CSV, and persist after reload', async ({page}) => {
  await page.goto('/')
  await page.getByRole('button',{name:'载入示例'}).click()
  await page.getByRole('button',{name:'公式列',exact:true}).click()
  await page.getByLabel('结果列名').fill('双倍水温')
  await page.getByLabel('左操作数').selectOption({label:'水温（℃）'})
  await page.getByRole('combobox',{name:'运算',exact:true}).selectOption('*')
  await page.getByLabel('常数值').fill('2')
  await expect(page.locator('#formula-preview')).toContainText('41')
  await page.getByRole('button',{name:'创建公式列'}).click()
  const first = page.getByLabel('第 1 行 双倍水温')
  await expect(first).toHaveValue('41')
  await page.getByLabel('第 1 行 水温（℃）').fill('25')
  await expect(first).toHaveValue('50')
  await page.getByLabel('Y 轴').selectOption({label:'双倍水温'})
  await expect(page.getByRole('img',{name:/折线图 · 6 个点/})).toBeVisible()
  await page.getByText('统计分析',{exact:true}).click()
  await expect(page.getByLabel('分析列').locator('option:checked')).toHaveText('双倍水温')
  await page.reload()
  await expect(first).toHaveValue('50')
  const download = page.waitForEvent('download')
  await page.getByRole('button',{name:'导出 CSV'}).click()
  expect(await readFile(await (await download).path(),'utf8')).toContain('0,25,初始,50')
  await page.getByRole('button',{name:'编辑列 水温（℃）'}).click()
  await expect(page.getByRole('button',{name:'删除列'})).toBeDisabled()
})

async function clickFirstMark(page: Page, selector: string) {
  const canvas = page.locator(selector + ' canvas').first()
  const point = await canvas.evaluate(element => {
    const canvas = element as HTMLCanvasElement, ctx = canvas.getContext('2d')!
    const { width,height } = canvas
    const data = ctx.getImageData(0,0,width,height).data
    const rect = canvas.getBoundingClientRect()
    // Pick a point inside a rendered data mark rather than a fixed screen coordinate.
    for (let x = 0; x < width - 2; x++) for (let y = 0; y < height; y++) {
      const i = 4*(y*width+x)
      if (data[i] === 8 && data[i+1] === 117 && data[i+2] === 101 && data[i+3] === 255) {
        return { x:(x+1)*rect.width/width, y:(y+.5)*rect.height/height }
      }
    }
    throw Error('未找到图形')
  })
  await canvas.click({position:point})
}

test('apply local recommendation, click both linked charts, reset and switch records', async ({page}) => {
  await page.goto('/')
  await page.getByRole('button',{name:'AI 推荐'}).click()
  await expect(page.locator('#suggest-list')).toContainText('暂无合适推荐')
  await page.getByRole('button',{name:'关闭',exact:true}).click()
  await page.getByRole('button',{name:'载入示例'}).click()
  await page.getByRole('button',{name:'AI 推荐'}).click()
  await page.getByRole('button',{name:'应用柱状图'}).click()
  await expect(page.getByRole('button',{name:'柱状图',exact:true})).toHaveAttribute('aria-pressed','true')
  await expect(page.getByLabel('X 轴').locator('option:checked')).toHaveText('实验阶段')
  await page.getByText('联动看板',{exact:true}).click()
  await expect(page.locator('#dash-status')).toContainText('选中 6 / 6 项')
  await clickFirstMark(page,'#dash-histogram')
  await expect(page.locator('#dash-status')).toContainText('选中 2 / 6 项')
  await expect(page.locator('#dash-profile')).toHaveAttribute('aria-label','按行测量图，选中 2 项')
  await clickFirstMark(page,'#dash-profile')
  await expect(page.locator('#dash-status')).toContainText('选中 6 / 6 项')
  await page.getByLabel('筛选区间').selectOption('2')
  await expect(page.locator('#dash-status')).toContainText('选中 2 / 6 项')
  await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.getByRole('button',{name:'未命名实验',exact:true}).click()
  await expect(page.locator('#dash-status')).toContainText('暂无有效数值')
})
