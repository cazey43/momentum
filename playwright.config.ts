import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end configuration.
 *
 * Browsers are installed into a project-local cache rather than the default
 * machine-level one, so a checkout is self-contained and nothing outside this
 * folder is touched:
 *
 *   npx playwright install chromium
 *
 * The env var is set here as well as at install time, because the browser
 * launcher reads it at run time too.
 */
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(process.cwd(), '.playwright-browsers')
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // A single local SQLite file; parallel runs would collide.
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Seeds a clean demo dataset, then serves a production build.
    command: 'npm run db:migrate && npm run db:seed && npm run build && npm run start',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    // migrate + seed + production build + boot on a cold cache.
    timeout: 420_000,
  },
})
