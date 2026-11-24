import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { empiricalCDF, linearFit, meanTest, outlierFences, summarize } from '../src/statistics'

test('IQR bounds use the two half-medians and handle small or constant samples', () => {
  expect(outlierFences([1, 2, 3])).toBeNull()
  expect(outlierFences([8, 8, 8, 8])).toEqual({lower:8, upper:8})
  expect(outlierFences([50, 1, 2, 3, 4, 5, 6, 7])).toEqual({lower:-3.5, upper:12.5})
  expect(outlierFences([1, 2, 3, 4, 100])).toEqual({lower:-74.25, upper:127.75})
})

test('outlier marks follow the original row, selected column and edited value', async ({ page }) => {
  await page.goto('/')
  await page.getByText('统计分析', {exact:true}).click()
  await expect(page.locator('#outlier-status')).toContainText('至少需要 4')
  for (let i = 3; i < 10; i++) await page.getByRole('button', {name:'新增行'}).click()
  const values = ['1', '', '2', 'abc', '3', '4', '5', '6', '7', '50']
  for (const [index, value] of values.entries()) {
    if (value) await page.getByLabel('第 ' + (index + 1) + ' 行 测量值', {exact:true}).fill(value)
  }
  const flagged = page.getByLabel('第 10 行 测量值', {exact:true})
  await expect(page.locator('#outlier-list li')).toHaveText(['第 10 行 · 50'])
  await expect(flagged).toHaveAttribute('data-outlier','true')
  await page.getByLabel('分析列').selectOption({label:'时间（秒）'})
  await expect(page.locator('[data-outlier]')).toHaveCount(0)
  await page.getByLabel('分析列').selectOption({label:'测量值'})
  await expect(flagged).toHaveAttribute('data-outlier','true')
  await flagged.fill('12.5')
  await expect(page.locator('#outlier-status')).toContainText('标记 0 项')
  await flagged.fill('8')
  await expect(page.locator('#outlier-list')).toBeHidden()
  await expect(page.locator('[data-outlier]')).toHaveCount(0)
})

test('known distributions, variances, t probabilities and degenerate samples', () => {
  const summary = summarize([1, 3, 5])
  expect(summary.mean).toBe(3)
  expect(summary.variance).toBeCloseTo(8 / 3, 12)
  expect(summary.sampleVariance).toBe(4)
  expect(meanTest(summary, 1)?.p).toBeCloseTo(1 - Math.sqrt(3 / 5), 7)
  expect(meanTest(summarize([-1, 1]), 1)?.p).toBeCloseTo(0.5, 7)
  expect(meanTest(summary, 3)?.p).toBe(1)
  expect(meanTest(summarize([2, 2]), 1)).toBeNull()
  expect(meanTest(summarize([2]), 1)).toBeNull()
  expect(empiricalCDF([3, 1, 1, 5])).toEqual([[1, 0], [1, 0.5], [3, 0.75], [5, 1]])
  expect(empiricalCDF([])).toEqual([])
  expect(linearFit([[1, 1], [1, 2]])).toBeNull()
  expect(linearFit([[0, 2], [1, 2]])?.r2).toBeNull()
})

test('slope, units, PNG trend, analysis settings and invalid measurements', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', {name:'散点图'}).click()
  await page.getByLabel('显示线性趋势线').check()
  await expect(page.locator('#trend-note')).toContainText('拟合需要')
  for (const [i, y] of [1, 3, 5].entries()) {
    await page.getByLabel('第 ' + (i + 1) + ' 行 时间（秒）').fill(String(i))
    await page.getByLabel('第 ' + (i + 1) + ' 行 测量值').fill(String(y))
  }
  await expect(page.locator('#trend-note')).toHaveText('斜率 2 1/秒 · 截距 1 · R² 1')
  const download = page.waitForEvent('download')
  await page.getByRole('button', {name:'导出 PNG'}).click()
  const buffer = await readFile(await (await download).path())
  expect(await page.evaluate(async encoded => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + encoded
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const pixels = ctx.getImageData(0, 0, img.width, img.height).data
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 87 && pixels[i+1] === 82 && pixels[i+2] === 133) return true
    }
    return false
  }, buffer.toString('base64'))).toBe(true)
  await page.getByText('统计分析', {exact:true}).click()
  await expect(page.locator('#stat-mean')).toHaveText('3')
  await expect(page.locator('#stat-var')).toHaveText('2.66667')
  await expect(page.locator('#stat-svar')).toHaveText('4')
  await page.getByLabel('假设均值 μ₀').fill('1')
  await expect(page.locator('#test-result')).toContainText('p = 0.225403')
  await page.getByLabel('显著性水平 α').selectOption('0.01')
  await page.getByLabel('假设均值 μ₀').fill('200')
  await expect(page.locator('#test-result')).toContainText('拒绝原假设（')
  await page.reload()
  await expect(page.getByLabel('显示线性趋势线')).toBeChecked()
  await page.getByText('统计分析', {exact:true}).click()
  await expect(page.getByLabel('显著性水平 α')).toHaveValue('0.01')
  await expect(page.getByLabel('假设均值 μ₀')).toHaveValue('200')
  await page.getByLabel('第 1 行 测量值').fill('abc')
  await expect(page.locator('#analysis-count')).toContainText('有效 2 项')
  await page.getByLabel('分析列').selectOption({label:'时间（秒）'})
  await expect(page.locator('#stat-mean')).toHaveText('1 秒')
  await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test('two tabs merge different cells and resolve either choice on the same cell', async ({page,context}) => {
  const other = await context.newPage()
  await page.goto('/')
  await expect(page.locator('#save-status')).toHaveText('已保存到本机')
  await other.goto('/')
  const cell = (tab: typeof page, row: number) => tab.getByLabel('第 ' + row + ' 行 测量值')
  await Promise.all([cell(page,1).fill('11'),cell(other,2).fill('22')])
  for (const tab of [page,other]) await expect(tab.locator('#save-status')).toHaveText('已保存到本机')
  await page.reload()
  await expect(cell(page,1)).toHaveValue('11')
  await expect(cell(page,2)).toHaveValue('22')
  for (const keepOurs of [false,true]) {
    await other.reload()
    const theirs = keepOurs ? '77' : '33'
    await cell(page,1).fill(theirs)
    await expect(page.locator('#save-status')).toHaveText('已保存到本机')
    let message = ''
    other.once('dialog', async dialog => {
      message = dialog.message()
      if (keepOurs) await dialog.accept()
      else await dialog.dismiss()
    })
    await cell(other,1).fill('99')
    await expect.poll(() => message).toContain('第 1 行 · 测量值')
    await expect(other.locator('#save-status')).toHaveText('已保存到本机')
    await page.reload()
    await expect(cell(page,1)).toHaveValue(keepOurs ? '99' : theirs)
    await expect(cell(page,2)).toHaveValue('22')
  }
})
