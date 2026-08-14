import { stopScheduler } from './index'

/**
 * Signal handlers for a clean scheduler shutdown.
 *
 * Isolated in its own module so it can be imported dynamically from the
 * Node-only branch of `instrumentation.ts`. Referencing `process.once` at the
 * top level of that file makes Turbopack compile it into the Edge bundle too,
 * where the API does not exist — which surfaces as a build error rather than
 * being silently ignored.
 */
export function registerShutdownHandlers(): void {
  const shutdown = () => {
    stopScheduler()
  }

  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
