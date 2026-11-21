import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

const temp = resolve('.work', 'browser-temp')
mkdirSync(temp, { recursive: true })
process.env.TEMP = temp
process.env.TMP = temp
process.env.TMPDIR = temp
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.work', 'pw-browsers')

export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
