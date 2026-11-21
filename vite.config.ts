import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    watch: { ignored: ['**/.work/**', '**/test-results/**', '**/playwright-report/**'] },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/zrender/')) return 'chart-canvas'
          if (id.includes('/node_modules/echarts/')) return 'charts'
        },
      },
    },
  },
})
