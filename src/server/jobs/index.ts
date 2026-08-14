import { and, eq, gte } from 'drizzle-orm'
import type { DomainItem } from '@/core/domain/items'
import { daysOverdue, daysWaiting } from '@/core/domain/items'
import type { PolicyPreferences, PolicyState } from '@/core/policy/persistence'
import { hashBody, planNudges } from '@/core/policy/persistence'
import { localDateString, systemClock } from '@/core/time/clock'
import { getDb } from '@/db/client'
import { listItems } from '@/db/repositories/items'
import { items, jobRuns, reminderEvents, reminders, userPreferences } from '@/db/schema'
import { generateBriefing } from '@/server/briefing/generate'
import { newId } from '@/server/ids'
import { JOB_INTERVALS, type ScheduledJobDefinition, Scheduler } from './scheduler'
import { type SyncResult, syncEmailThreads } from './sync'

/**
 * Background jobs.
 *
 * Each job records a `job_runs` row so the UI can show when sync last
 * succeeded and what failed, rather than silently doing nothing.
 *
 * These are plain async functions with no scheduler baked in. A timer, a cron
 * entry, or a button in Settings can all drive them, and tests call them
 * directly.
 */

async function withJobRun<T>(jobName: string, work: () => Promise<T>): Promise<T | null> {
  const db = await getDb()
  const startedAt = systemClock.now()
  // Random suffix, not just a timestamp: the scheduler runs jobs concurrently,
  // so two starting in the same millisecond would otherwise collide on the
  // primary key and one would fail before doing any work.
  const id = newId(`job_${jobName}`, startedAt)

  await db.insert(jobRuns).values({ id, jobName, status: 'running', startedAt })

  try {
    const result = await work()
    await db
      .update(jobRuns)
      .set({ status: 'succeeded', finishedAt: systemClock.now() })
      .where(eq(jobRuns.id, id))
    return result
  } catch (error) {
    await db
      .update(jobRuns)
      .set({
        status: 'failed',
        finishedAt: systemClock.now(),
        // The message only — never the payload that caused it, which could
        // contain private mail content.
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      .where(eq(jobRuns.id, id))
    return null
  }
}

async function loadPolicyPreferences(userId: string): Promise<PolicyPreferences | null> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1)

  const prefs = rows[0]
  if (!prefs) return null

  return {
    timezone: prefs.timezone,
    quietHoursStart: prefs.quietHoursStart,
    quietHoursEnd: prefs.quietHoursEnd,
    dailyNudgeBudget: prefs.dailyNudgeBudget,
    reminderIntensity: prefs.reminderIntensity,
    proactiveRemindersPaused: prefs.proactiveRemindersPaused,
    weekendReminders: prefs.weekendReminders,
  }
}

async function loadPolicyState(userId: string, localDate: string): Promise<PolicyState> {
  const db = await getDb()

  const todaysEvents = await db
    .select()
    .from(reminderEvents)
    .where(and(eq(reminderEvents.userId, userId), eq(reminderEvents.localDate, localDate)))

  const delivered = todaysEvents.filter((e) => e.eventType === 'delivered').length

  // The ignored streak counts consecutive deliveries with no engagement after
  // them. Computed from the ledger rather than stored, so it cannot drift.
  let ignoredStreak = 0
  for (const event of [...todaysEvents].reverse()) {
    if (event.eventType === 'delivered' || event.eventType === 'ignored') {
      ignoredStreak += 1
    } else {
      break
    }
  }

  const existingReminders = await db
    .select({ bodyHash: reminders.bodyHash })
    .from(reminders)
    .where(
      and(
        eq(reminders.userId, userId),
        gte(reminders.createdAt, new Date(Date.now() - 30 * 86_400_000)),
      ),
    )

  return {
    nudgesDeliveredToday: delivered,
    ignoredStreak,
    usedBodyHashes: new Set(existingReminders.map((r) => r.bodyHash)),
  }
}

/** Wording for a nudge. Plain, specific, and never repeated verbatim. */
function bodyForItem(item: DomainItem, ctx: { now: Date; zone: string }): string {
  const overdue = daysOverdue(item, ctx)
  const waiting = daysWaiting(item, ctx)

  if (waiting > 0) {
    const who = item.counterpartName ?? 'someone'
    return `Still waiting on ${who} about “${item.title}” — ${waiting} days now.`
  }
  if (overdue === 1) {
    return `“${item.title}” passed its date yesterday.`
  }
  if (overdue > 1) {
    return `“${item.title}” is ${overdue} days past the date you set.`
  }
  return `“${item.title}” is due today.`
}

export interface NudgeRoundResult {
  delivered: number
  bundled: number
  askedToChooseOne: boolean
  suppressed: number
}

/**
 * One round of proactive reminders.
 *
 * All the judgment lives in the pure policy engine; this function only loads
 * state, applies the plan, and records what happened.
 */
export async function runNudgeRound(userId: string): Promise<NudgeRoundResult | null> {
  return withJobRun('nudge_round', async () => {
    const now = systemClock.now()
    const prefs = await loadPolicyPreferences(userId)
    if (!prefs) return { delivered: 0, bundled: 0, askedToChooseOne: false, suppressed: 0 }

    const ctx = { now, zone: prefs.timezone }
    const localDate = localDateString(now, prefs.timezone)
    const state = await loadPolicyState(userId, localDate)
    const all = await listItems(userId)

    const plan = planNudges(all, ctx, prefs, state, (item) => bodyForItem(item, ctx))
    const db = await getDb()

    for (const { item, decision } of plan.deliver) {
      if (!decision.body || !decision.bodyHash) continue

      await db.insert(reminders).values({
        id: `rem_${item.id}_${now.getTime()}`,
        userId,
        itemId: item.id,
        level: decision.level,
        scheduledFor: now,
        body: decision.body,
        bodyHash: decision.bodyHash,
        status: 'delivered',
        deliveredAt: now,
      })

      await db.insert(reminderEvents).values({
        id: `revt_${item.id}_${now.getTime()}`,
        userId,
        eventType: 'delivered',
        localDate,
      })

      await db
        .update(items)
        .set({ nudgeCount: item.nudgeCount + 1, lastNudgedAt: now })
        .where(and(eq(items.id, item.id), eq(items.userId, userId)))
    }

    // Suppressed reminders are recorded too, so Settings can explain exactly
    // why the app stayed quiet rather than looking broken.
    for (const { item, reason } of plan.suppressed) {
      const body = `suppressed:${reason}:${item.id}`
      await db
        .insert(reminders)
        .values({
          id: `rem_sup_${item.id}_${now.getTime()}`,
          userId,
          itemId: item.id,
          level: 'silent',
          scheduledFor: now,
          body,
          bodyHash: hashBody(body),
          status: 'suppressed',
          suppressionReason: reason,
        })
        .onConflictDoNothing()
    }

    return {
      delivered: plan.deliver.length,
      bundled: plan.bundled.length,
      askedToChooseOne: plan.askToChooseOne.length > 0,
      suppressed: plan.suppressed.length,
    }
  })
}

/**
 * Generates the daily briefing, honoring quiet hours and the once-a-day rule.
 *
 * The once-a-day guarantee is the unique index on (user, local date); this
 * function only decides *whether now is an appropriate moment*.
 */
export async function runDailyBriefing(userId: string): Promise<boolean | null> {
  return withJobRun('daily_briefing', async () => {
    const now = systemClock.now()
    const prefs = await loadPolicyPreferences(userId)
    if (!prefs) return false
    if (prefs.proactiveRemindersPaused) return false

    const briefing = await generateBriefing(userId, { now, zone: prefs.timezone })
    return briefing !== null
  })
}

/** Pulls mailbox metadata. Wrapped so failures land in `job_runs`. */
export async function runEmailSync(userId: string): Promise<SyncResult | null> {
  return withJobRun('email_sync', () => syncEmailThreads(userId))
}

/** Everything that should run on a tick. */
export async function runDueJobs(userId: string): Promise<void> {
  await runEmailSync(userId)
  await runNudgeRound(userId)
}

/**
 * The scheduled job registry.
 *
 * Three jobs, matching the three the specification names: sync, briefing
 * generation, and reminders. Each is already idempotent — sync upserts, the
 * briefing is protected by a unique index on (user, local date), and the nudge
 * round is gated by the persistence policy's daily budget — so a missed or
 * repeated tick is safe.
 */
export function buildScheduledJobs(userId: string): ScheduledJobDefinition[] {
  return [
    {
      name: 'email_sync',
      intervalMs: JOB_INTERVALS.emailSync,
      run: () => runEmailSync(userId),
      runOnStart: true,
    },
    {
      name: 'nudge_round',
      intervalMs: JOB_INTERVALS.nudgeRound,
      run: () => runNudgeRound(userId),
    },
    {
      name: 'daily_briefing',
      intervalMs: JOB_INTERVALS.dailyBriefing,
      run: () => runDailyBriefing(userId),
    },
  ]
}

let activeScheduler: Scheduler | null = null

/**
 * Starts the scheduler once per process.
 *
 * Opt-in via `MOMENTUM_ENABLE_SCHEDULER`, and never during tests or a build —
 * background timers that fire mid-build produce confusing, non-reproducible
 * output.
 */
export function startScheduler(userId: string): Scheduler | null {
  if (activeScheduler) return activeScheduler
  if (process.env.MOMENTUM_ENABLE_SCHEDULER !== 'true') return null
  if (process.env.MOMENTUM_ENV === 'test' || process.env.NODE_ENV === 'test') return null

  activeScheduler = new Scheduler({
    jobs: buildScheduledJobs(userId),
    onEvent: (event) => {
      if (event.type === 'run_failed') {
        console.error(`[scheduler] ${event.job} failed: ${event.error}`)
      } else if (event.type === 'started') {
        console.warn(`[scheduler] started: ${event.jobs.join(', ')}`)
      }
    },
  })

  activeScheduler.start()
  return activeScheduler
}

export function stopScheduler(): void {
  activeScheduler?.stop()
  activeScheduler = null
}

export function getScheduler(): Scheduler | null {
  return activeScheduler
}
