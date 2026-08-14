import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JOB_INTERVALS, Scheduler, type SchedulerEvent } from './scheduler'

/**
 * Scheduler tests run entirely on vitest's fake clock, so they are
 * deterministic and finish in milliseconds rather than waiting for real
 * intervals to elapse.
 */

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function collector() {
  const events: SchedulerEvent[] = []
  return { events, onEvent: (e: SchedulerEvent) => events.push(e) }
}

const countRuns = (events: SchedulerEvent[], job: string) =>
  events.filter((e) => e.type === 'run_started' && e.job === job).length

describe('interval firing', () => {
  it('does not run a job before its first interval elapses', async () => {
    const run = vi.fn(async () => {})
    const scheduler = new Scheduler({ jobs: [{ name: 'a', intervalMs: 1000, run }] })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(999)
    expect(run).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)

    scheduler.stop()
  })

  it('runs once per interval, exactly', async () => {
    const run = vi.fn(async () => {})
    const scheduler = new Scheduler({ jobs: [{ name: 'a', intervalMs: 1000, run }] })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(10)

    scheduler.stop()
  })

  it('runs immediately when runOnStart is set, then on the interval', async () => {
    const run = vi.fn(async () => {})
    const scheduler = new Scheduler({
      jobs: [{ name: 'a', intervalMs: 1000, run, runOnStart: true }],
    })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1) // the immediate run

    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)

    scheduler.stop()
  })

  it('gives each job its own timer, so intervals stay independent', async () => {
    const fast = vi.fn(async () => {})
    const slow = vi.fn(async () => {})
    const scheduler = new Scheduler({
      jobs: [
        { name: 'fast', intervalMs: 100, run: fast },
        { name: 'slow', intervalMs: 1000, run: slow },
      ],
    })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(1000)
    expect(fast).toHaveBeenCalledTimes(10)
    expect(slow).toHaveBeenCalledTimes(1)

    scheduler.stop()
  })
})

describe('no duplicate execution', () => {
  it('SKIPS a tick when the previous run of that job is still in flight', async () => {
    // The important one. Two concurrent nudge rounds would each read the same
    // daily budget and could deliver twice what the user allowed.
    let release: (() => void) | undefined
    const started = vi.fn()

    const run = vi.fn(async () => {
      started()
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })

    const { events, onEvent } = collector()
    const scheduler = new Scheduler({ jobs: [{ name: 'slow', intervalMs: 100, run }], onEvent })
    scheduler.start()

    // First tick starts a run that never finishes on its own.
    await vi.advanceTimersByTimeAsync(100)
    expect(started).toHaveBeenCalledTimes(1)

    // Five more ticks pass while it is still running.
    await vi.advanceTimersByTimeAsync(500)
    expect(started).toHaveBeenCalledTimes(1)
    expect(events.filter((e) => e.type === 'run_skipped_overlap')).toHaveLength(5)

    // Once it completes, the next tick runs normally.
    release?.()
    await vi.advanceTimersByTimeAsync(100)
    expect(started).toHaveBeenCalledTimes(2)

    scheduler.stop()
  })

  it('reports which jobs are currently executing', async () => {
    let release: (() => void) | undefined
    const run = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })

    const scheduler = new Scheduler({ jobs: [{ name: 'slow', intervalMs: 100, run }] })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(100)
    expect(scheduler.activeJobs).toEqual(['slow'])

    release?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(scheduler.activeJobs).toEqual([])

    scheduler.stop()
  })

  it('overlap in one job does not block a different job', async () => {
    let release: (() => void) | undefined
    const blocked = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
    const other = vi.fn(async () => {})

    const scheduler = new Scheduler({
      jobs: [
        { name: 'blocked', intervalMs: 100, run: blocked },
        { name: 'other', intervalMs: 100, run: other },
      ],
    })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(500)
    expect(blocked).toHaveBeenCalledTimes(1) // stuck after the first
    expect(other).toHaveBeenCalledTimes(5) // unaffected

    release?.()
    scheduler.stop()
  })

  it('starting twice does not double the timers', async () => {
    const run = vi.fn(async () => {})
    const scheduler = new Scheduler({ jobs: [{ name: 'a', intervalMs: 100, run }] })

    scheduler.start()
    scheduler.start() // second call must be a no-op

    await vi.advanceTimersByTimeAsync(500)
    expect(run).toHaveBeenCalledTimes(5)

    scheduler.stop()
  })
})

describe('failure isolation', () => {
  it('keeps scheduling after a job throws', async () => {
    const failing = vi.fn(async () => {
      throw new Error('mailbox unreachable')
    })

    const { events, onEvent } = collector()
    const scheduler = new Scheduler({
      jobs: [{ name: 'sync', intervalMs: 100, run: failing }],
      onEvent,
    })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(300)

    expect(failing).toHaveBeenCalledTimes(3)
    expect(events.filter((e) => e.type === 'run_failed')).toHaveLength(3)
    expect(scheduler.isRunning).toBe(true)

    scheduler.stop()
  })

  it('records the failure reason without throwing out of the scheduler', async () => {
    const { events, onEvent } = collector()
    const scheduler = new Scheduler({
      jobs: [
        {
          name: 'sync',
          intervalMs: 100,
          run: async () => {
            throw new Error('mailbox unreachable')
          },
        },
      ],
      onEvent,
    })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(100)

    const failure = events.find((e) => e.type === 'run_failed')
    expect(failure).toMatchObject({ job: 'sync', error: 'mailbox unreachable' })

    scheduler.stop()
  })

  it('a failing job does not prevent a healthy one from running', async () => {
    const healthy = vi.fn(async () => {})
    const scheduler = new Scheduler({
      jobs: [
        {
          name: 'broken',
          intervalMs: 100,
          run: async () => {
            throw new Error('boom')
          },
        },
        { name: 'healthy', intervalMs: 100, run: healthy },
      ],
    })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(300)
    expect(healthy).toHaveBeenCalledTimes(3)

    scheduler.stop()
  })
})

describe('stopping', () => {
  it('fires nothing further after stop', async () => {
    const run = vi.fn(async () => {})
    const scheduler = new Scheduler({ jobs: [{ name: 'a', intervalMs: 100, run }] })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(200)
    expect(run).toHaveBeenCalledTimes(2)

    scheduler.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('is safe to stop when never started', () => {
    const scheduler = new Scheduler({ jobs: [] })
    expect(() => scheduler.stop()).not.toThrow()
    expect(scheduler.isRunning).toBe(false)
  })

  it('can be restarted after stopping', async () => {
    const run = vi.fn(async () => {})
    const scheduler = new Scheduler({ jobs: [{ name: 'a', intervalMs: 100, run }] })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(100)
    scheduler.stop()

    scheduler.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(2)

    scheduler.stop()
  })
})

describe('the real job schedule', () => {
  it('runs all three jobs at their configured intervals over a simulated day', async () => {
    const nudge = vi.fn(async () => {})
    const briefing = vi.fn(async () => {})
    const sync = vi.fn(async () => {})

    const { events, onEvent } = collector()
    const scheduler = new Scheduler({
      jobs: [
        { name: 'nudge_round', intervalMs: JOB_INTERVALS.nudgeRound, run: nudge },
        { name: 'daily_briefing', intervalMs: JOB_INTERVALS.dailyBriefing, run: briefing },
        { name: 'email_sync', intervalMs: JOB_INTERVALS.emailSync, run: sync },
      ],
      onEvent,
    })
    scheduler.start()

    const oneDay = 24 * 60 * 60_000
    await vi.advanceTimersByTimeAsync(oneDay)

    expect(nudge).toHaveBeenCalledTimes(oneDay / JOB_INTERVALS.nudgeRound) // 96
    expect(briefing).toHaveBeenCalledTimes(oneDay / JOB_INTERVALS.dailyBriefing) // 24
    expect(sync).toHaveBeenCalledTimes(oneDay / JOB_INTERVALS.emailSync) // 144

    // Nothing was skipped, because nothing overlapped.
    expect(events.filter((e) => e.type === 'run_skipped_overlap')).toHaveLength(0)
    expect(countRuns(events, 'nudge_round')).toBe(96)

    scheduler.stop()
  })

  it('keeps every interval a whole number of minutes, so ticks align predictably', () => {
    for (const [name, ms] of Object.entries(JOB_INTERVALS)) {
      expect(ms % 60_000, `${name} should be a whole number of minutes`).toBe(0)
    }
  })
})
