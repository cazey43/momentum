import { createHash } from 'node:crypto'
import { type BucketContext, type DomainItem, daysOverdue, daysWaiting } from '@/core/domain/items'
import {
  awaitsSomeoneElse,
  isClosed,
  isPassive,
  type ReminderLevel,
} from '@/core/domain/vocabulary'
import { daysBetweenLocal, isWeekend, localTimeOnDay } from '@/core/time/clock'

/**
 * The Gentle Persistence Policy.
 *
 * A first-class engine rather than reminder logic scattered across features.
 * Everything here is a pure function of (items, preferences, history, clock),
 * which is what makes "we never nudge during quiet hours" a testable claim
 * instead of an aspiration.
 *
 * The governing principle, from the spec: persistent enough to be useful,
 * never nagging. In every ambiguous case this engine chooses silence.
 */

export interface PolicyPreferences {
  timezone: string
  quietHoursStart: string
  quietHoursEnd: string
  dailyNudgeBudget: number
  reminderIntensity: ReminderLevel
  proactiveRemindersPaused: boolean
  weekendReminders: boolean
}

export interface PolicyState {
  /** Proactive nudges already delivered in the user's local day. */
  nudgesDeliveredToday: number
  /**
   * Consecutive delivered nudges the user did not act on. At two, the engine
   * stops nudging and asks what they would like to do instead.
   */
  ignoredStreak: number
  /** Hashes of wording already used, so nothing is ever repeated verbatim. */
  usedBodyHashes: ReadonlySet<string>
}

export type SuppressionReason =
  | 'globally_paused'
  | 'quiet_hours'
  | 'weekend'
  | 'budget_exhausted'
  | 'item_muted'
  | 'remind_once_already_used'
  | 'recently_engaged'
  | 'snoozed'
  | 'closed'
  | 'passive_kind'
  | 'not_yet_due'
  | 'duplicate_wording'
  | 'awaiting_user_direction'

export interface NudgeDecision {
  deliver: boolean
  level: ReminderLevel
  /** Present when deliver is false. Shown in Settings for transparency. */
  suppressionReason?: SuppressionReason
  body?: string
  bodyHash?: string
}

export function hashBody(body: string): string {
  return createHash('sha256').update(body.trim().toLowerCase()).digest('hex').slice(0, 32)
}

/**
 * Quiet hours, evaluated in local wall-clock time.
 *
 * Handles the overnight wrap (20:00–08:00 spans midnight), which a naive
 * `start <= now <= end` comparison gets wrong for every hour of the night.
 */
export function isWithinQuietHours(now: Date, prefs: PolicyPreferences): boolean {
  const start = localTimeOnDay(now, prefs.timezone, prefs.quietHoursStart)
  const end = localTimeOnDay(now, prefs.timezone, prefs.quietHoursEnd)
  const t = now.getTime()

  if (start.getTime() <= end.getTime()) {
    // Same-day window, e.g. 13:00–15:00.
    return t >= start.getTime() && t < end.getTime()
  }

  // Overnight window: quiet if after the evening start OR before the morning end.
  return t >= start.getTime() || t < end.getTime()
}

/**
 * How loudly this item justifies speaking.
 *
 * `urgent` requires a real, imminent, high-impact deadline — the spec is
 * explicit that urgency must be supported by the data. Nothing here escalates
 * because something has merely been ignored.
 */
export function escalationFor(item: DomainItem, ctx: BucketContext): ReminderLevel {
  if (isPassive(item.kind)) return 'silent'

  // Waiting on someone else never escalates past `gentle`. A follow-up date
  // that has passed is not a deadline the user missed — the next move is not
  // theirs, and raising the volume would imply otherwise.
  if (awaitsSomeoneElse(item.kind)) return 'gentle'

  const overdue = daysOverdue(item, ctx)
  const target = item.dueAt ?? item.followUpAt
  const daysUntil = target ? daysBetweenLocal(ctx.now, target, ctx.zone) : null

  if (item.priority === 'high' && overdue > 0) return 'urgent'
  if (item.priority === 'high' && daysUntil !== null && daysUntil <= 1) return 'urgent'
  if (overdue > 0) return 'direct'
  if (daysUntil !== null && daysUntil <= 1) return 'direct'
  if (daysWaiting(item, ctx) >= 7) return 'gentle'
  return 'gentle'
}

const LEVEL_ORDER: Record<ReminderLevel, number> = {
  silent: 0,
  gentle: 1,
  direct: 2,
  urgent: 3,
}

/**
 * Decides whether a single item may be nudged about.
 *
 * The order of checks is the policy. Global pause and quiet hours come first
 * because no per-item consideration can override them.
 */
export function decideForItem(
  item: DomainItem,
  ctx: BucketContext,
  prefs: PolicyPreferences,
  state: PolicyState,
  proposedBody: string,
): NudgeDecision {
  const level = escalationFor(item, ctx)
  const deny = (suppressionReason: SuppressionReason): NudgeDecision => ({
    deliver: false,
    level,
    suppressionReason,
  })

  // --- Absolute blocks -----------------------------------------------------
  if (prefs.proactiveRemindersPaused) return deny('globally_paused')
  if (isWithinQuietHours(ctx.now, prefs)) return deny('quiet_hours')
  if (!prefs.weekendReminders && isWeekend(ctx.now, prefs.timezone)) return deny('weekend')

  // --- Explicit user instructions about this item --------------------------
  if (item.remindersMuted) return deny('item_muted')
  if (item.remindOnce && item.nudgeCount >= 1) return deny('remind_once_already_used')
  if (isClosed(item.status)) return deny('closed')
  if (isPassive(item.kind)) return deny('passive_kind')

  if (item.snoozedUntil && item.snoozedUntil.getTime() > ctx.now.getTime()) {
    return deny('snoozed')
  }

  // Opened, snoozed, dismissed, completed, or discussed recently — they have
  // it in hand, so raising it again is nagging.
  if (item.lastEngagedAt && daysBetweenLocal(item.lastEngagedAt, ctx.now, ctx.zone) < 1) {
    return deny('recently_engaged')
  }

  // --- After two ignored nudges, stop and ask -----------------------------
  // The engine hands control back rather than escalating into someone who is
  // clearly not responding.
  if (state.ignoredStreak >= 2) return deny('awaiting_user_direction')

  // --- Budget --------------------------------------------------------------
  if (state.nudgesDeliveredToday >= prefs.dailyNudgeBudget) return deny('budget_exhausted')

  // --- Is there anything worth saying yet? ---------------------------------
  const target = item.dueAt ?? item.followUpAt
  const daysUntil = target ? daysBetweenLocal(ctx.now, target, ctx.zone) : null
  const isWaiting = daysWaiting(item, ctx) >= 5
  if (!isWaiting && (daysUntil === null || daysUntil > 1)) return deny('not_yet_due')

  // --- Respect the user's chosen intensity ---------------------------------
  if (LEVEL_ORDER[level] < LEVEL_ORDER[prefs.reminderIntensity]) {
    return deny('not_yet_due')
  }

  // --- Never repeat wording ------------------------------------------------
  const bodyHash = hashBody(proposedBody)
  if (state.usedBodyHashes.has(bodyHash)) return deny('duplicate_wording')

  return { deliver: true, level, body: proposedBody, bodyHash }
}

export interface NudgePlan {
  /** Individually delivered nudges. */
  deliver: { item: DomainItem; decision: NudgeDecision }[]
  /** Low-urgency items rolled into one message instead of several. */
  bundled: DomainItem[]
  /** Set when the engine wants the user to pick one thing rather than be listed at. */
  askToChooseOne: DomainItem[]
  suppressed: { item: DomainItem; reason: SuppressionReason }[]
}

/**
 * Plans a whole round of nudges.
 *
 * Two spec rules only make sense at this level:
 *
 * - **Bundling**: several low-urgency reminders become one message, not three.
 * - **Choose one**: when many things are overdue, listing them all repeatedly
 *   is demoralizing and useless. Past a threshold the engine asks the user to
 *   pick a single next step instead.
 */
export function planNudges(
  items: readonly DomainItem[],
  ctx: BucketContext,
  prefs: PolicyPreferences,
  state: PolicyState,
  bodyFor: (item: DomainItem) => string,
): NudgePlan {
  const plan: NudgePlan = { deliver: [], bundled: [], askToChooseOne: [], suppressed: [] }

  // Mutable across the round: a hash must be registered the moment an item is
  // found eligible, not after every decision has been made. Otherwise two
  // items with identical wording both pass, and the user is told the same
  // thing twice in one round.
  const usedBodyHashes = new Set(state.usedBodyHashes)

  const working: PolicyState = {
    nudgesDeliveredToday: state.nudgesDeliveredToday,
    ignoredStreak: state.ignoredStreak,
    usedBodyHashes,
  }

  const eligible: { item: DomainItem; decision: NudgeDecision }[] = []

  for (const item of items) {
    const decision = decideForItem(item, ctx, prefs, working, bodyFor(item))
    if (!decision.deliver) {
      if (decision.suppressionReason) {
        plan.suppressed.push({ item, reason: decision.suppressionReason })
      }
      continue
    }
    if (decision.bodyHash) usedBodyHashes.add(decision.bodyHash)
    eligible.push({ item, decision })
  }

  // Most pressing first, so a tight budget is spent on what matters.
  eligible.sort((a, b) => LEVEL_ORDER[b.decision.level] - LEVEL_ORDER[a.decision.level])

  const overdueUrgent = eligible.filter(
    (e) => e.decision.level === 'urgent' || e.decision.level === 'direct',
  )

  // Three or more genuinely pressing things: ask for one decision rather than
  // delivering three separate reminders.
  if (overdueUrgent.length >= 3) {
    plan.askToChooseOne = overdueUrgent.map((e) => e.item)
    return plan
  }

  for (const candidate of eligible) {
    if (working.nudgesDeliveredToday >= prefs.dailyNudgeBudget) {
      plan.suppressed.push({ item: candidate.item, reason: 'budget_exhausted' })
      continue
    }

    if (candidate.decision.level === 'gentle') {
      // Gentle items ride along in a bundle; they do not each cost budget.
      plan.bundled.push(candidate.item)
      continue
    }

    plan.deliver.push(candidate)
    working.nudgesDeliveredToday += 1
  }

  // A bundle is itself one nudge and must fit the budget.
  if (plan.bundled.length > 0 && working.nudgesDeliveredToday >= prefs.dailyNudgeBudget) {
    for (const item of plan.bundled) {
      plan.suppressed.push({ item, reason: 'budget_exhausted' })
    }
    plan.bundled = []
  }

  return plan
}

/**
 * The message shown after two ignored nudges.
 *
 * Phrased as a genuine question with real options, not a guilt trip. The point
 * is to hand control back.
 */
export function chooseOnePrompt(items: readonly DomainItem[]): string {
  const count = items.length
  return [
    `There are ${count} things past their date. Rather than list them each day, which would you like to do?`,
    'Pick one to work on, push them all out a week, or lower their priority — any of those is a fine answer.',
  ].join(' ')
}

export function pausedPrompt(): string {
  return [
    'I have mentioned this a couple of times and do not want to keep repeating myself.',
    'Would you like to snooze it, reschedule it, lower its priority, or stop reminders for it?',
  ].join(' ')
}
