import { type BucketContext, type DomainItem, daysWaiting } from '@/core/domain/items'
import type { ConfidenceLevel } from '@/core/domain/vocabulary'
import { isClosed } from '@/core/domain/vocabulary'
import { daysBetweenLocal } from '@/core/time/clock'

/**
 * Loose-end detection.
 *
 * The deterministic half of the engine. These rules run over structure —
 * dates, reply patterns, status age — and never over meaning, so they are
 * exact and testable. The model handles the other half: reading prose for
 * commitments and questions.
 *
 * Every candidate must be able to answer four questions, because the UI is
 * contractually obliged to display all four: what may need attention, why we
 * think so, which source and when, and how confident we are.
 *
 * Language discipline: `headline` and `why` are user-facing and always hedged.
 * The engine surfaces possibilities, never accusations.
 */

export interface LooseEndCandidate {
  /** Stable id so dismissing one keeps it dismissed. */
  key: string
  signal: LooseEndSignal
  headline: string
  why: string
  confidence: ConfidenceLevel
  suggestedAction: string
  itemId?: string
  sourceRecordId?: string
  occurredAt: Date | null
}

export type LooseEndSignal =
  | 'stale_waiting'
  | 'stale_in_progress'
  | 'repeatedly_postponed'
  | 'delegated_no_outcome'
  | 'untriaged_too_long'
  | 'passed_due_unacknowledged'

export interface SignalThresholds {
  /** Days of silence before a waiting-for item is worth surfacing. */
  staleWaitingDays: number
  /** Days in progress with no update before it is probably stuck. */
  staleInProgressDays: number
  /** Snoozes before the pattern itself is the signal. */
  postponeCount: number
  /** Days a delegated item can sit with no recorded outcome. */
  delegatedSilenceDays: number
  /** Days something can sit untriaged in the inbox. */
  untriagedDays: number
}

export const DEFAULT_THRESHOLDS: SignalThresholds = {
  staleWaitingDays: 5,
  staleInProgressDays: 14,
  postponeCount: 3,
  delegatedSilenceDays: 7,
  untriagedDays: 4,
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/**
 * Runs the structural detectors over the user's items.
 *
 * Deliberately excludes anything the user has muted, dismissed, snoozed, or
 * recently engaged with — a loose end they have already looked at is not a
 * loose end, and re-raising it is exactly the nagging the spec forbids.
 */
export function detectStructuralLooseEnds(
  items: readonly DomainItem[],
  ctx: BucketContext,
  thresholds: SignalThresholds = DEFAULT_THRESHOLDS,
): LooseEndCandidate[] {
  const candidates: LooseEndCandidate[] = []

  for (const item of items) {
    if (isClosed(item.status)) continue
    if (item.remindersMuted) continue

    // An active snooze is an explicit "not now". Respect it silently.
    if (item.snoozedUntil && item.snoozedUntil.getTime() > ctx.now.getTime()) continue

    // Engaged with in the last day: they have seen it. Leave them alone.
    if (item.lastEngagedAt && daysBetweenLocal(item.lastEngagedAt, ctx.now, ctx.zone) < 1) {
      continue
    }

    const waiting = daysWaiting(item, ctx)

    if (item.kind === 'waiting_for' && waiting >= thresholds.staleWaitingDays) {
      candidates.push({
        key: `stale_waiting:${item.id}`,
        signal: 'stale_waiting',
        headline: `${item.counterpartName ?? 'Someone'} may not have replied yet`,
        why: `You have been waiting ${plural(waiting, 'day')}, with nothing recorded since.`,
        confidence: waiting >= thresholds.staleWaitingDays * 2 ? 'high' : 'medium',
        suggestedAction: 'Send a short nudge, or set this aside for now.',
        itemId: item.id,
        occurredAt: item.followUpAt ?? item.createdAt,
      })
      continue
    }

    if (item.kind === 'delegated' && waiting >= thresholds.delegatedSilenceDays) {
      candidates.push({
        key: `delegated_no_outcome:${item.id}`,
        signal: 'delegated_no_outcome',
        headline: `No outcome recorded for something you handed to ${item.counterpartName ?? 'someone'}`,
        why: `Delegated ${plural(waiting, 'day')} ago with no result noted since.`,
        confidence: 'medium',
        suggestedAction: 'Ask how it went, or close it out if it is already done.',
        itemId: item.id,
        occurredAt: item.followUpAt ?? item.createdAt,
      })
      continue
    }

    if (item.status === 'in_progress') {
      const idle = daysBetweenLocal(item.updatedAt, ctx.now, ctx.zone)
      if (idle >= thresholds.staleInProgressDays) {
        candidates.push({
          key: `stale_in_progress:${item.id}`,
          signal: 'stale_in_progress',
          headline: 'This has been in progress for a while',
          why: `Marked in progress ${plural(idle, 'day')} ago and not updated since. It may be stuck or already finished.`,
          confidence: 'medium',
          suggestedAction: 'Mark it done, or note what it is blocked on.',
          itemId: item.id,
          occurredAt: item.updatedAt,
        })
        continue
      }
    }

    if (item.nudgeCount >= thresholds.postponeCount) {
      candidates.push({
        key: `repeatedly_postponed:${item.id}`,
        signal: 'repeatedly_postponed',
        headline: 'This keeps getting put off',
        why: `It has come up ${plural(item.nudgeCount, 'time')} without moving. That usually means the next step is unclear, or it is not really a priority.`,
        confidence: 'medium',
        suggestedAction: 'Break it down, reschedule it properly, or let it go.',
        itemId: item.id,
        occurredAt: item.lastNudgedAt,
      })
      continue
    }

    if (item.status === 'inbox') {
      const age = daysBetweenLocal(item.createdAt, ctx.now, ctx.zone)
      if (age >= thresholds.untriagedDays) {
        candidates.push({
          key: `untriaged:${item.id}`,
          signal: 'untriaged_too_long',
          headline: 'Captured but never sorted',
          why: `This has sat untriaged for ${plural(age, 'day')}.`,
          confidence: 'low',
          suggestedAction: 'Give it a date, or dismiss it.',
          itemId: item.id,
          occurredAt: item.createdAt,
        })
      }
    }
  }

  return candidates
}

/**
 * Orders candidates for review: strongest evidence first, then oldest.
 *
 * High-confidence items lead so the review queue starts with things most
 * likely to be real, which is what makes the queue worth opening.
 */
export function orderCandidates(candidates: readonly LooseEndCandidate[]): LooseEndCandidate[] {
  const rank: Record<ConfidenceLevel, number> = { high: 0, medium: 1, low: 2 }
  return [...candidates].sort((a, b) => {
    if (rank[a.confidence] !== rank[b.confidence]) return rank[a.confidence] - rank[b.confidence]
    const aTime = a.occurredAt?.getTime() ?? 0
    const bTime = b.occurredAt?.getTime() ?? 0
    return aTime - bTime
  })
}

/**
 * Guard against accusatory phrasing reaching the UI.
 *
 * Used as a test assertion and as a runtime check on model-authored copy: the
 * spec forbids stating an inference as fact or blaming the user, so wording
 * that does either is rejected rather than displayed.
 */
const ACCUSATORY_PATTERNS: readonly RegExp[] = [
  /\byou (forgot|failed|neglected|ignored|dropped the ball)\b/i,
  /\byou (never|didn't|did not) (reply|respond|do|finish)\b/i,
  /\b(you are|you're) (behind|late|slipping)\b/i,
  /\bshould have\b/i,
  /!{2,}/,
  /\bURGENT\b/,
]

export function isAccusatory(text: string): boolean {
  return ACCUSATORY_PATTERNS.some((pattern) => pattern.test(text))
}
