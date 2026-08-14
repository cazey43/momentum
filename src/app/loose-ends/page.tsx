import { EmptyState, PageHeader } from '@/components/PageHeader'
import { detectStructuralLooseEnds, orderCandidates } from '@/core/looseends/signals'
import { systemClock } from '@/core/time/clock'
import { listItems } from '@/db/repositories/items'
import { loadSourcesForItems } from '@/db/repositories/sources'
import { getSession } from '@/server/session'
import {
  dismissLooseEnd,
  markNotRelevant,
  promoteToTask,
  resolveLooseEnd,
  snoozeLooseEnd,
} from './actions'

export const metadata = { title: 'Loose Ends' }
export const dynamic = 'force-dynamic'

const CONFIDENCE_COPY = {
  high: 'Fairly confident',
  medium: 'Possible',
  low: 'Uncertain',
} as const

const CONFIDENCE_CLASS = {
  high: 'bg-done-soft text-done',
  medium: 'bg-waiting-soft text-waiting',
  low: 'bg-surface-sunken text-ink-muted',
} as const

const SMALL_BUTTON =
  'rounded-md border border-line px-3 py-1 text-xs text-ink-muted hover:bg-surface-sunken'

export default async function LooseEndsPage() {
  const { userId, zone } = await getSession()
  const ctx = { now: systemClock.now(), zone }

  const all = await listItems(userId)
  const candidates = orderCandidates(detectStructuralLooseEnds(all, ctx))

  const itemsById = new Map(all.map((item) => [item.id, item]))
  const sources = await loadSourcesForItems(
    userId,
    candidates.map((c) => c.itemId).filter((id): id is string => Boolean(id)),
  )

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Loose Ends"
        blurb="Things that may have slipped. Each one shows what it is based on, so you can judge for yourself."
      />

      {candidates.length === 0 ? (
        <EmptyState
          message="Nothing looks like it has slipped."
          hint="Momentum checks for silent threads, stalled work, and things you captured but never sorted."
        />
      ) : (
        <div className="space-y-4">
          {candidates.map((candidate) => {
            const item = candidate.itemId ? itemsById.get(candidate.itemId) : undefined
            const evidence = candidate.itemId ? (sources.get(candidate.itemId) ?? []) : []

            return (
              <article
                key={candidate.key}
                className="rounded-card border border-line bg-surface p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${CONFIDENCE_CLASS[candidate.confidence]}`}
                  >
                    {CONFIDENCE_COPY[candidate.confidence]}
                  </span>
                  {candidate.occurredAt ? (
                    <span className="text-xs text-ink-faint">
                      Since{' '}
                      {new Intl.DateTimeFormat('en-US', {
                        day: 'numeric',
                        month: 'short',
                        timeZone: zone,
                      }).format(candidate.occurredAt)}
                    </span>
                  ) : null}
                </div>

                <h2 className="mt-2 font-medium text-ink">{candidate.headline}</h2>

                {item ? <p className="mt-1 text-sm text-ink">{item.title}</p> : null}

                {/* Why it was detected — required on every card. */}
                <p className="mt-2 text-sm text-ink-muted">{candidate.why}</p>

                {/* Source and date — also required on every card. */}
                {evidence.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {evidence.map((source) => (
                      <li key={source.id} className="text-xs text-ink-faint">
                        <span className="font-medium text-ink-muted">
                          {source.title ?? 'Source'}
                        </span>
                        {source.author ? ` · ${source.author}` : ''}
                        {source.excerpt ? (
                          <span className="mt-0.5 block border-l-2 border-line pl-2 italic">
                            “{source.excerpt}”
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-ink-faint">
                    Based on the timing of this item rather than a specific message.
                  </p>
                )}

                <p className="mt-3 text-sm text-ink-muted">
                  <span className="font-medium text-ink">Suggested:</span>{' '}
                  {candidate.suggestedAction}
                </p>

                {candidate.itemId ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <form action={resolveLooseEnd}>
                      <input type="hidden" name="itemId" value={candidate.itemId} />
                      <button type="submit" className={SMALL_BUTTON}>
                        Already handled
                      </button>
                    </form>
                    <form action={promoteToTask}>
                      <input type="hidden" name="itemId" value={candidate.itemId} />
                      <button type="submit" className={SMALL_BUTTON}>
                        Make it a task
                      </button>
                    </form>
                    <form action={snoozeLooseEnd}>
                      <input type="hidden" name="itemId" value={candidate.itemId} />
                      <input type="hidden" name="days" value="3" />
                      <button type="submit" className={SMALL_BUTTON}>
                        Not now
                      </button>
                    </form>
                    <form action={markNotRelevant}>
                      <input type="hidden" name="itemId" value={candidate.itemId} />
                      <button type="submit" className={SMALL_BUTTON}>
                        Not relevant
                      </button>
                    </form>
                    <form action={dismissLooseEnd}>
                      <input type="hidden" name="itemId" value={candidate.itemId} />
                      <button type="submit" className={SMALL_BUTTON}>
                        Dismiss
                      </button>
                    </form>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
