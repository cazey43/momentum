/**
 * The job scheduler.
 *
 * A small, deliberately boring interval runner. Three properties matter, and
 * each is covered by a fake-timer test:
 *
 *   1. **Each job fires on its own interval** — a slow job does not delay a
 *      fast one, because each has its own timer rather than sharing a tick.
 *   2. **No overlapping execution of the same job.** If a run is still in
 *      flight when its next tick arrives, that tick is skipped rather than
 *      queued. Two concurrent nudge rounds would both read the same daily
 *      budget and could double-spend it.
 *   3. **A failing job does not stop the scheduler** or affect any other job.
 *
 * Timers are injected so tests drive them with vitest's fake clock instead of
 * waiting in real time.
 */

export interface ScheduledJobDefinition {
  name: string
  intervalMs: number
  run: () => Promise<unknown>
  /** Run once immediately on start, in addition to on the interval. */
  runOnStart?: boolean
}

export interface SchedulerOptions {
  jobs: ScheduledJobDefinition[]
  /** Injected so tests can assert on what was reported without stubbing console. */
  onEvent?: (event: SchedulerEvent) => void
}

export type SchedulerEvent =
  | { type: 'started'; jobs: string[] }
  | { type: 'run_started'; job: string }
  | { type: 'run_finished'; job: string }
  | { type: 'run_failed'; job: string; error: string }
  | { type: 'run_skipped_overlap'; job: string }
  | { type: 'stopped' }

export class Scheduler {
  private readonly jobs: ScheduledJobDefinition[]
  private readonly onEvent: (event: SchedulerEvent) => void
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>()
  /** Names of jobs with a run currently in flight. The overlap guard. */
  private readonly inFlight = new Set<string>()
  private running = false

  constructor(options: SchedulerOptions) {
    this.jobs = options.jobs
    this.onEvent = options.onEvent ?? (() => {})
  }

  get isRunning(): boolean {
    return this.running
  }

  /** Jobs currently executing. Exposed for assertions and diagnostics. */
  get activeJobs(): string[] {
    return [...this.inFlight]
  }

  start(): void {
    if (this.running) return
    this.running = true

    for (const job of this.jobs) {
      if (job.runOnStart) {
        void this.execute(job)
      }

      const timer = setInterval(() => {
        void this.execute(job)
      }, job.intervalMs)

      // Do not hold the process open purely for a timer.
      if (typeof timer === 'object' && 'unref' in timer) {
        ;(timer as { unref: () => void }).unref()
      }

      this.timers.set(job.name, timer)
    }

    this.onEvent({ type: 'started', jobs: this.jobs.map((j) => j.name) })
  }

  stop(): void {
    if (!this.running) return
    for (const timer of this.timers.values()) {
      clearInterval(timer)
    }
    this.timers.clear()
    this.running = false
    this.onEvent({ type: 'stopped' })
  }

  /**
   * Runs one job, guarding against overlap and swallowing failures.
   *
   * Exported behaviour, not an implementation detail: callers rely on a failed
   * job leaving the schedule intact.
   */
  private async execute(job: ScheduledJobDefinition): Promise<void> {
    if (this.inFlight.has(job.name)) {
      this.onEvent({ type: 'run_skipped_overlap', job: job.name })
      return
    }

    this.inFlight.add(job.name)
    this.onEvent({ type: 'run_started', job: job.name })

    try {
      await job.run()
      this.onEvent({ type: 'run_finished', job: job.name })
    } catch (error) {
      this.onEvent({
        type: 'run_failed',
        job: job.name,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      this.inFlight.delete(job.name)
    }
  }
}

/** Intervals, in one place so they are reviewable at a glance. */
export const JOB_INTERVALS = {
  /**
   * Reminder rounds. The Gentle Persistence Policy — quiet hours, the daily
   * budget, suppression — decides whether anything is actually delivered, so a
   * frequent tick is cheap and just means the policy is consulted often.
   */
  nudgeRound: 15 * 60_000,
  /**
   * Briefing generation. The unique index on (user, local date) makes a second
   * generation on the same day a no-op, so an hourly tick simply catches the
   * user's configured briefing time without needing cron semantics.
   */
  dailyBriefing: 60 * 60_000,
  /** Mailbox sync. */
  emailSync: 10 * 60_000,
} as const
