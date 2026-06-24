import { defineConfig } from 'vitest/config'

// Unit tests for the crypto-critical, pure-logic paths (no Electron runtime).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
