import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    rollupOptions: {
      // The dashboard is opened in a full tab via chrome.tabs.create rather than
      // being referenced from the manifest, so Rollup needs it named explicitly.
      input: { dashboard: resolve(__dirname, 'src/ui/dashboard/index.html') },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // CRXJS serves HMR over a fixed port so the service worker can reconnect.
    hmr: { port: 5174 },
  },
})
