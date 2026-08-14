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

/**
 * The e2e suite runs fully isolated from the dev instance, on its own database
 * and its own port.
 *
 * This matters because the suite is not read-only: it captures rows
 * (`Buy milk ${Date.now()}`), approves a draft, snoozes an item, and toggles the
 * global pause. Pointed at the dev database (`momentum.db` on :3000) it corrupts
 * real data and leaves test rows visible in the running app. A separate DB file
 * and port guarantee the two never touch, whatever happens to be running.
 */
const E2E_PORT = 3100
const E2E_DATABASE_URL = 'file:./momentum.e2e.db'

/**
 * A hermetic environment for the suite, so results do not depend on the
 * developer's personal `.env.local`.
 *
 * `next start` loads `.env.local`, and the account-connection tests assert the
 * *unconfigured* Microsoft state (no Connect button, /start → 400, full setup
 * checklist). A machine with real MS_GRAPH_* / encryption values would fail
 * those tests. Next only applies a
 * `.env.local` value when the key is absent from `process.env`; an empty string
 * counts as present, so these blanks reliably win. DATABASE_URL redirects the
 * whole migrate/seed/build/start chain to the isolated database.
 */
const E2E_ENV = {
  DATABASE_URL: E2E_DATABASE_URL,
  MS_GRAPH_CLIENT_ID: '',
  MS_GRAPH_TENANT_ID: '',
  MS_GRAPH_CLIENT_SECRET: '',
  MS_GRAPH_REDIRECT_URI: '',
  MOMENTUM_ENCRYPTION_KEY: '',
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // A single local SQLite file; parallel runs would collide.
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Seeds a clean demo dataset into the isolated DB, then serves a production
    // build on the isolated port. Never reuses an existing server: the suite
    // asserts against the exact seeded dataset, so a stray dev server (different
    // DB, mutated state) would fail or, worse, pass for the wrong reason.
    command: `npm run db:migrate && npm run db:seed && npm run build && npm run start -- -p ${E2E_PORT}`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    env: E2E_ENV,
    reuseExistingServer: false,
    // migrate + seed + production build + boot on a cold cache.
    timeout: 420_000,
  },
})
