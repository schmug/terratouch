// Standalone vitest config (not merged with vite.config.ts): the sim is pure
// TS with no DOM, so tests need neither the React nor the PWA plugin.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
