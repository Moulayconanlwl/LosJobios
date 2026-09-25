import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/**
 * Separate from vite.config.ts on purpose: the CRXJS plugin builds a whole
 * extension bundle, which the unit tests neither need nor should wait for.
 */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'happy-dom',
    // .tsx so the React surfaces can be tested too — two of the worst bugs in
    // this codebase were controlled inputs fighting their own state, which is
    // only reproducible by actually typing into one.
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
})
