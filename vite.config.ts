import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': import.meta.dirname + '/src',
    },
  },
  server: {
    // API lives in server.mjs (holds the shared Connect identity from env).
    proxy: {
      '/api': 'http://localhost:8083',
      // WebSocket session hub — /api/ws must be upgraded, not proxied as HTTP.
      '/api/ws': { target: 'ws://localhost:8083', ws: true },
    },
  },
})
