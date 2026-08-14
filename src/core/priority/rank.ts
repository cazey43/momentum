import {
  type BucketContext,
  bucketOf,
  type DomainItem,
  daysOverdue,
  daysWaiting,
} from '@/core/domain/items'
import { isPassive } from '@/core/domain/vocabulary'
import { daysBetweenLocal } from '@/core/time/clock'

/**
 * Prioritization.
 *
 * The spec is explicit that a score alone is not acceptable — the user must be
 * told *why* something is at the top. So scoring is decomposed into named
 * factors, each of which carries the sentence it would contribute, and the
 * dominant factor supplies the displayed reason.
 *
 * This is deterministic business logic and stays deterministic: the model is
 * never asked to rank. It may only supply the inputs (a due date it extracted,
 * a confidence level), never the ordering.
 */

export interface RankFactor {
  /** Stable identifier, useful in tests and debugging. */
  key: string
  /** Positive raises priority, negative lowers it. */
  weight: number
  /** Fragment shown to the user when this factor dominates. */
  explanation: string
}

export interface RankedItem {
  item: DomainItem
  score: number
  /** The single sentence shown under the item in the UI. */
  reason: string
  factors: RankFactor[]
}

/**
 * Weights are intentionally small integers rather than tuned constants. This
 * is a heuristic that has to be explainable to the user; a black box with
 * three decimal places would be neither.
 */
const WEIGHTS = {
  overduePerDay: 6,
  overdueCap: 40,
  dueToday: 30,
  dueTomorrow: 16,
  dueThisWeek: 8,
  highPriority: 14,
  lowPriority: -8,
  inProgress: 6,
  blocked: -4,
  waitingPerDay: 2,
  waitingCap: 18,
  lowConfidencePenalty: -10,
  mediumConfidencePenalty: -3,
  passivePenalty: -50,
  staleInProgress: 5,
} as const

export function scoreItem(item: DomainItem, ctx: BucketContext): RankFactor[] {
  const factors: RankFactor[] = []
  const bucket = bucketOf(item, ctx)

  // --- Time pressure --------------------------------------------------------
  const overdue = daysOverdue(item, ctx)
  if (overdue > 0) {
    factors.push({
      key: 'overdue',
      weight: Math.min(overdue * WEIGHTS.overduePerDay, WEIGHTS.overdueCap),
      explanation: overdue === 1 ? 'was due yesterday' : `was due ${overdue} days ago`,
    })
  } else if (bucket === 'today') {
    factors.push({ key: 'due_today', weight: WEIGHTS.dueToday, explanation: 'is due today' })
  } else {
    const target = item.dueAt ?? item.followUpAt
    if (target) {
      const days = daysBetweenLocal(ctx.now, target, ctx.zone)
      if (days === 1) {
        factors.push({
          key: 'due_tomorrow',
          weight: WEIGHTS.dueTomorrow,
          explanation: 'is due tomorrow',
        })
      } else if (days > 1 && days <= 7) {
        factors.push({
          key: 'due_this_week',
          weight: WEIGHTS.dueThisWeek,
          explanation: `is due in ${days} days`,
        })
      }
    }
  }

  // --- Stated importance ----------------------------------------------------
  if (item.priority === 'high') {
    factors.push({
      key: 'high_priority',
      weight: WEIGHTS.highPriority,
      explanation: 'you marked it high priority',
    })
  } else if (item.priority === 'low') {
    factors.push({
      key: 'low_priority',
      weight: WEIGHTS.lowPriority,
      explanation: 'you marked it low priority',
    })
  }

  // --- Progress and dependencies -------------------------------------------
  if (item.status === 'in_progress') {
    factors.push({
      key: 'in_progress',
      weight: WEIGHTS.inProgress,
      explanation: 'is already underway',
    })

    // Something "in progress" for a fortnight is usually stuck, not moving.
    const age = daysBetweenLocal(item.updatedAt, ctx.now, ctx.zone)
    if (age >= 14) {
      factors.push({
        key: 'stale_in_progress',
        weight: WEIGHTS.staleInProgress,
        explanation: `has been in progress for ${age} days without an update`,
      })
    }
  }

  if (item.status === 'blocked') {
    factors.push({
      key: 'blocked',
      weight: WEIGHTS.blocked,
      explanation: 'is blocked on something else',
    })
  }

  // --- Waiting on other people ---------------------------------------------
  const waiting = daysWaiting(item, ctx)
  if (waiting > 0) {
    factors.push({
      key: 'waiting',
      weight: Math.min(waiting * WEIGHTS.waitingPerDay, WEIGHTS.waitingCap),
      explanation: item.counterpartName
        ? `you have been waiting on ${item.counterpartName} for ${waiting} days`
        : `you have been waiting ${waiting} days`,
    })
  }

  // --- Confidence -----------------------------------------------------------
  // An uncertain guess should not outrank something the user recorded
  // themselves. This is what stops a shaky inference reaching the top of Today.
  if (item.origin === 'ai') {
    if (item.confidence === 'low') {
      factors.push({
        key: 'low_confidence',
        weight: WEIGHTS.lowConfidencePenalty,
        explanation: 'but this was inferred and may not be right',
      })
    } else if (item.confidence === 'medium') {
      factors.push({
        key: 'medium_confidence',
        weight: WEIGHTS.mediumConfidencePenalty,
        explanation: 'though this one was inferred rather than recorded by you',
      })
    }
  }

  // --- Passive kinds --------------------------------------------------------
  if (isPassive(item.kind)) {
    factors.push({
      key: 'passive',
      weight: WEIGHTS.passivePenalty,
      explanation: 'is parked for someday rather than now',
    })
  }

  return factors
}

/** Picks the sentence the user sees: the largest positive contributor. */
export function explain(factors: RankFactor[]): string {
  const positives = factors.filter((f) => f.weight > 0).sort((a, b) => b.weight - a.weight)
  const dominant = positives[0]

  if (!dominant) {
    const negative = [...factors].sort((a, b) => a.weight - b.weight)[0]
    return negative ? `Low priority — ${negative.explanation}.` : 'No time pressure on this one.'
  }

  // A caveat (a negative factor with an explanation) is appended so the app
  // never presents a confident-sounding reason for an uncertain inference.
  const caveat = factors.find((f) => f.key === 'low_confidence' || f.key === 'medium_confidence')
  const base = `This ${dominant.explanation}`
  return caveat ? `${base}, ${caveat.explanation}.` : `${base}.`
}

export function rankItems(items: readonly DomainItem[], ctx: BucketContext): RankedItem[] {
  return items
    .map((item) => {
      const factors = scoreItem(item, ctx)
      const score = factors.reduce((sum, f) => sum + f.weight, 0)
      return { item, score, reason: explain(factors), factors }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      // Stable, meaningful tiebreak: the older commitment goes first.
      return a.item.createdAt.getTime() - b.item.createdAt.getTime()
    })
}

/**
 * The "top three priorities" on the Today dashboard.
 *
 * Only ever returns items the user can actually act on, and never pads to
 * three — showing two real priorities is better than three with a filler.
 */
export function topPriorities(
  items: readonly DomainItem[],
  ctx: BucketContext,
  limit = 3,
): RankedItem[] {
  return rankItems(items, ctx)
    .filter((ranked) => {
      const bucket = bucketOf(ranked.item, ctx)
      return bucket === 'overdue' || bucket === 'today' || bucket === 'inbox'
    })
    .slice(0, limit)
}
