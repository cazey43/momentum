import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { ItemCard } from '@/components/ItemCard'
import { EmptyState, Section } from '@/components/PageHeader'
import { DEMO_USER_NAME } from '@/config/demo'
import { topPriorities } from '@/core/priority/rank'
import { systemClock } from '@/core/time/clock'
import { getDb } from '@/db/client'
import { groupByBucket, listItems } from '@/db/repositories/items'
import { loadSourcesForItems } from '@/db/repositories/sources'
import { emailDrafts } from '@/db/schema'
import { getOrCreateTodaysBriefing } from '@/server/briefing/generate'
import { getSession } from '@/server/session'
import { completeItemAction, quickCapture, snoozeItemAction } from './actions'

export const dynamic = 'force-dynamic'

function greeting(now: Date, zone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: zone }).format(
      now,
    ),
  )
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default async function TodayPage() {
  const { userId, zone } = await getSession()
  const now = systemClock.now()
  const ctx = { now, zone }

  const all = await listItems(userId)
  const buckets = groupByBucket(all, ctx)
  const priorities = topPriorities(all, ctx)
  const briefing = await getOrCreateTodaysBriefing(userId, ctx)

  const db = await getDb()
  const pendingDrafts = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.userId, userId), eq(emailDrafts.status, 'drafted')))
    .orderBy(desc(emailDrafts.createdAt))

  const sources = await loadSourcesForItems(
    userId,
    all.map((i) => i.id),
  )

  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: zone,
  }).format(now)

  const nothingPressing =
    buckets.overdue.length === 0 && buckets.today.length === 0 && buckets.inbox.length === 0

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <p className="text-sm text-ink-faint">{dateLabel}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
          {greeting(now, zone)}, {DEMO_USER_NAME}
        </h1>
      </header>

      {/* Quick capture sits first: capturing a thought must never require
          navigating anywhere. */}
      <form action={quickCapture} className="mb-6 flex gap-2">
        <label htmlFor="capture" className="sr-only-focusable">
          Capture a task, thought, promise, or follow-up
        </label>
        <input
          id="capture"
          name="capture"
          type="text"
          autoComplete="off"
          placeholder="Capture anything — try “waiting: Dana on the contract”"
          className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
        />
        <button
          type="submit"
          className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
        >
          Capture
        </button>
      </form>

      {briefing ? (
        <section
          aria-labelledby="briefing-heading"
          className="mb-8 rounded-card border border-line bg-surface p-5"
        >
          <h2 id="briefing-heading" className="text-sm font-semibold text-ink">
            Your briefing
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{briefing.short}</p>

          {briefing.expanded ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-ink-muted hover:text-ink">
                Show the full picture
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">{briefing.expanded}</p>
            </details>
          ) : null}

          {briefing.encouragement ? (
            <p className="mt-4 border-t border-line pt-3 text-sm text-ink-muted italic">
              {briefing.encouragement.body}
              {briefing.encouragement.attribution ? ` — ${briefing.encouragement.attribution}` : ''}
            </p>
          ) : null}
        </section>
      ) : null}

      <Link
        href="/talk"
        className="mb-8 flex items-center justify-center rounded-card bg-accent px-4 py-3 text-sm font-medium text-on-accent hover:bg-accent-hover"
      >
        Talk to Momentum
      </Link>

      {priorities.length > 0 ? (
        <section className="mb-8" aria-labelledby="priorities-heading">
          <h2
            id="priorities-heading"
            className="mb-3 text-sm font-semibold tracking-wide text-ink-muted uppercase"
          >
            Suggested first
          </h2>
          <ol className="space-y-3">
            {priorities.map((ranked) => (
              <li key={ranked.item.id}>
                <ItemCard
                  item={ranked.item}
                  ctx={ctx}
                  sources={sources.get(ranked.item.id) ?? []}
                  reason={ranked.reason}
                />
                <div className="mt-2 flex gap-2">
                  <form action={completeItemAction}>
                    <input type="hidden" name="itemId" value={ranked.item.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-line px-3 py-1 text-xs text-ink-muted hover:bg-surface-sunken"
                    >
                      Mark done
                    </button>
                  </form>
                  <form action={snoozeItemAction}>
                    <input type="hidden" name="itemId" value={ranked.item.id} />
                    <input type="hidden" name="days" value="1" />
                    <button
                      type="submit"
                      className="rounded-md border border-line px-3 py-1 text-xs text-ink-muted hover:bg-surface-sunken"
                    >
                      Not today
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {nothingPressing ? (
        <EmptyState
          message="Nothing urgent is hiding right now."
          hint="You can focus on the work you chose."
        />
      ) : null}

      <Section title="Overdue" count={buckets.overdue.length} tone="urgent">
        {buckets.overdue.map((item) => (
          <ItemCard key={item.id} item={item} ctx={ctx} sources={sources.get(item.id) ?? []} />
        ))}
      </Section>

      <Section title="Due today" count={buckets.today.length}>
        {buckets.today.map((item) => (
          <ItemCard key={item.id} item={item} ctx={ctx} sources={sources.get(item.id) ?? []} />
        ))}
      </Section>

      <Section title="Waiting on others" count={buckets.waiting.length}>
        {buckets.waiting.map((item) => (
          <ItemCard key={item.id} item={item} ctx={ctx} sources={sources.get(item.id) ?? []} />
        ))}
      </Section>

      <Section title="Possibly slipped" count={buckets.inbox.length}>
        {buckets.inbox.map((item) => (
          <ItemCard key={item.id} item={item} ctx={ctx} sources={sources.get(item.id) ?? []} />
        ))}
      </Section>

      {pendingDrafts.length > 0 ? (
        <section className="mb-8" aria-labelledby="drafts-heading">
          <h2
            id="drafts-heading"
            className="mb-3 text-sm font-semibold tracking-wide text-ink-muted uppercase"
          >
            Drafts awaiting your approval ({pendingDrafts.length})
          </h2>
          <div className="space-y-3">
            {pendingDrafts.map((draft) => (
              <Link
                key={draft.id}
                href="/drafts"
                className="block rounded-card border border-line bg-surface p-4 hover:bg-surface-sunken"
              >
                <p className="font-medium text-ink">{draft.subject}</p>
                <p className="mt-1 text-sm text-ink-muted">To {draft.toRecipients.join(', ')}</p>
                {draft.requiresCarefulReview ? (
                  <p className="mt-2 text-sm text-urgent">Worth reading closely before sending.</p>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
