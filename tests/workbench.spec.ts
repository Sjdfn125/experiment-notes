import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('manual entry, chart settings, persistence and downloaded CSV/PNG', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '未命名实验' })).toBeVisible()
  await expect(page.getByRole('button', { name: '导出 PNG' })).toBeDisabled()

  for (const [index, [seconds, value]] of [[0, -2.5], [30, 0], [90, 6.75]].entries()) {
    await page.getByRole('textbox', { name: `第 ${index + 1} 行 时间（秒）` }).fill(String(seconds))
    await page.getByRole('textbox', { name: `第 ${index + 1} 行 测量值` }).fill(String(value))
  }
  await expect(page.getByRole('img', { name: /折线图 · 3 个点/ })).toBeVisible()

  const changed = page.getByRole('textbox', { name: '第 2 行 测量值' })
  await changed.fill('abc')
  await expect(changed).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('已绘制 2 个点 · 1 行缺少有效的坐标数据')).toBeVisible()
  await changed.fill('1.25')
  await expect(changed).toHaveAttribute('aria-invalid', 'false')

  await page.getByRole('button', { name: '柱状图' }).click()
  await expect(page.getByRole('img', { name: /柱状图 · 3 个点/ })).toBeVisible()
  await page.getByRole('button', { name: '散点图' }).click()
  await page.getByLabel('图表标题').fill('数值校验实验')
  await page.getByLabel('系列颜色').fill('#c12c58')
  await page.reload()
  await expect(changed).toHaveValue('1.25')
  await expect(page.getByRole('textbox', { name: '第 1 行 时间（秒）' })).toHaveValue('0')
  await expect(page.getByRole('button', { name: '散点图' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('系列颜色')).toHaveValue('#c12c58')
  await expect(page.getByRole('img', { name: '数值校验实验 · 散点图 · 3 个点' })).toBeVisible()

  const csvEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 CSV' }).click()
  const csv = await csvEvent
  expect(csv.suggestedFilename()).toBe('未命名实验.csv')
  expect(await readFile(await csv.path(), 'utf8')).toBe('\uFEFF时间（秒）,测量值\r\n0,-2.5\r\n30,1.25\r\n90,6.75\r\n')

  const pngEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 PNG' }).click()
  const png = await pngEvent
  expect(png.suggestedFilename()).toBe('数值校验实验.png')
  const image = await readFile(await png.path())
  expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(image.readUInt32BE(16)).toBeGreaterThan(800)
  expect(image.readUInt32BE(20)).toBe(640)
  const hasSeriesColor = await page.evaluate(async encoded => {
    const image = new Image()
    image.src = 'data:image/png;base64,' + encoded
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const drawing = canvas.getContext('2d')!
    drawing.drawImage(image, 0, 0)
    const { data } = drawing.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 193 && data[i + 1] === 44 && data[i + 2] === 88) return true
    }
    return false
  }, image.toString('base64'))
  expect(hasSeriesColor).toBe(true)
  expect(errors).toEqual([])
})

test('record switching, dynamic columns, text CSV escaping and deletion', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新建记录' }).click()
  await page.getByRole('textbox', { name: '记录名称' }).fill('空白对照')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('heading', { name: '空白对照' })).toBeVisible()
  await page.getByRole('button', { name: '载入示例' }).click()
  await expect(page.getByRole('img', { name: /折线图 · 6 个点/ })).toBeVisible()

  await page.getByRole('button', { name: '编辑列 水温（℃）' }).click()
  await page.getByRole('textbox', { name: '列名' }).fill('液体温度')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByLabel('Y 轴').locator('option:checked')).toHaveText('液体温度（℃）')

  await page.getByRole('button', { name: '新增列' }).click()
  await page.getByRole('textbox', { name: '列名' }).fill('备注')
  await page.getByLabel('数据类型').selectOption('text')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '新增行' }).click()
  await page.getByRole('textbox', { name: '第 7 行 备注' }).fill('组 A, "重复"')

  await page.getByRole('button', { name: '柱状图' }).click()
  await page.getByLabel('X 轴').selectOption({ label: '实验阶段' })
  await expect(page.getByRole('img', { name: /柱状图 · 6 个点/ })).toBeVisible()
  await page.getByRole('button', { name: '散点图' }).click()
  await expect(page.getByLabel('X 轴').locator('option:checked')).toHaveText('加热时间（秒）')

  const csvEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 CSV' }).click()
  const csv = await csvEvent
  expect(await readFile(await csv.path(), 'utf8')).toContain(',,,"组 A, ""重复"""\r\n')

  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '删除第 7 行' }).click()
  await expect(page.getByText('6 行数据 · 4 列')).toBeVisible()
  await page.getByRole('button', { name: '编辑列 备注' }).click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '删除列' }).click()
  await expect(page.getByText('6 行数据 · 3 列')).toBeVisible()
  await page.getByRole('button', { name: '空白对照' }).click()
  await expect(page.getByRole('heading', { name: '空白对照' })).toBeVisible()
  await expect(page.getByRole('button', { name: '导出 PNG' })).toBeDisabled()
})

test('unreadable storage remains intact and a narrow display stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('experiment-notes/workspace/v1', '{unreadable'))
  await page.reload()
  await expect(page.getByText('本机数据读取失败 · 当前更改仅本次有效')).toBeVisible()
  await page.getByRole('button', { name: '载入示例' }).click()
  await expect(page.getByRole('img', { name: /折线图 · 6 个点/ })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('experiment-notes/workspace/v1'))).toBe('{unreadable')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  const rowAction = await page.getByRole('button', { name: '删除第 1 行' }).boundingBox()
  expect(rowAction!.x + rowAction!.width).toBeLessThan(390)
})
