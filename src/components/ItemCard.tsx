import { Evidence, type EvidenceSource } from '@/components/Evidence'
import type { BucketContext, DomainItem } from '@/core/domain/items'
import { daysOverdue, daysWaiting } from '@/core/domain/items'
import { ITEM_KIND_LABELS } from '@/core/domain/vocabulary'
import { describeRelativeDay } from '@/core/time/clock'

interface ItemCardProps {
  item: DomainItem
  ctx: BucketContext
  sources: EvidenceSource[]
  /** Optional ranking explanation from the prioritizer. */
  reason?: string
}

/**
 * Timing line for an item, phrased calmly.
 *
 * "2 days past the date you set" rather than "OVERDUE BY 2 DAYS". The spec is
 * explicit that the assistant must not manufacture urgency or use guilt.
 */
function timingLine(item: DomainItem, ctx: BucketContext): string | null {
  const overdue = daysOverdue(item, ctx)
  if (overdue > 0) {
    return overdue === 1 ? 'One day past the date you set' : `${overdue} days past the date you set`
  }

  const waiting = daysWaiting(item, ctx)
  if (waiting > 0) {
    const who = item.counterpartName ?? 'someone'
    return `Waiting on ${who} — ${waiting} ${waiting === 1 ? 'day' : 'days'}`
  }

  if (item.snoozedUntil && item.snoozedUntil.getTime() > ctx.now.getTime()) {
    return `Set aside until ${describeRelativeDay(item.snoozedUntil, ctx.now, ctx.zone)}`
  }

  const target = item.dueAt ?? item.followUpAt
  if (target) return `Due ${describeRelativeDay(target, ctx.now, ctx.zone)}`

  return null
}

export function ItemCard({ item, ctx, sources, reason }: ItemCardProps) {
  const timing = timingLine(item, ctx)
  const isOverdue = daysOverdue(item, ctx) > 0

  return (
    <article className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-medium text-ink-muted">
          {ITEM_KIND_LABELS[item.kind]}
        </span>

        {item.priority === 'high' ? (
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-ink">
            High priority
          </span>
        ) : null}

        {item.isDemo ? (
          <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-faint">
            Demo data
          </span>
        ) : null}
      </div>

      <h3 className="mt-2 font-medium text-ink">{item.title}</h3>

      {item.detail ? <p className="mt-1 text-sm text-ink-muted">{item.detail}</p> : null}

      {timing ? (
        <p className={`mt-2 text-sm ${isOverdue ? 'text-urgent' : 'text-ink-muted'}`}>{timing}</p>
      ) : null}

      {reason ? <p className="mt-1 text-sm text-ink-faint">{reason}</p> : null}

      {/*
        Any AI-authored item routes through Evidence, which requires a reason
        and sources. There is deliberately no branch that renders an inferred
        item without it.
      */}
      {item.origin === 'ai' ? (
        <Evidence confidence={item.confidence} reason={item.reason} sources={sources} />
      ) : null}
    </article>
  )
}
