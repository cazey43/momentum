import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Default to `node`: the bulk of the suite covers pure domain logic
    // (policy, priority, loose-end detection). Component tests opt into jsdom
    // with a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**'],
    setupFiles: ['./tests/setup.ts'],
    restoreMocks: true,
  },
})
