/**
 * Next.js instrumentation hook.
 *
 * Runs once when the server process boots — the only place in a Next app where
 * process-lifetime background work can be started without attaching it to a
 * request.
 *
 * The scheduler is opt-in (`MOMENTUM_ENABLE_SCHEDULER=true`) and confined to
 * the Node.js runtime. It is off by default because this is a local app that
 * spends most of its time not running, and silently mutating data in the
 * background is the sort of thing a user should switch on deliberately.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.MOMENTUM_ENABLE_SCHEDULER !== 'true') return

  // Imported lazily so the edge runtime and the build never pull in the
  // database client or any Node-only API.
  const { DEMO_USER_ID } = await import('@/config/demo')
  const { startScheduler } = await import('@/server/jobs')
  const { registerShutdownHandlers } = await import('@/server/jobs/shutdown')

  startScheduler(DEMO_USER_ID)

  // Drain cleanly rather than being killed mid-write.
  registerShutdownHandlers()
}
