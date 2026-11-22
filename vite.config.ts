import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  server: {
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/cmu': {
        target: 'https://www.CMUOmniClear.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cmu/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      },
      '/hkma': {
        target: 'https://api.hkma.gov.hk',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hkma/, ''),
      },
    },
  },
})
