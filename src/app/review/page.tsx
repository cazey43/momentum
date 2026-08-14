import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { ItemCard } from '@/components/ItemCard'
import { EmptyState, PageHeader, Section } from '@/components/PageHeader'
import { systemClock } from '@/core/time/clock'
import { getDb } from '@/db/client'
import { groupByBucket, listItems } from '@/db/repositories/items'
import { loadSourcesForItems } from '@/db/repositories/sources'
import { emailDrafts, emailThreadSummaries, emailThreads, proposedActions } from '@/db/schema'
import { getSession } from '@/server/session'
import { completeItemAction, snoozeItemAction } from '../actions'
import { promoteToTask } from '../loose-ends/actions'

export const metadata = { title: 'Review' }
export const dynamic = 'force-dynamic'

const SMALL_BUTTON =
  'rounded-md border border-line px-3 py-1 text-xs text-ink-muted hover:bg-surface-sunken'

/**
 * The single queue of everything waiting on the user's judgment.
 *
 * Deliberately one page rather than notification badges scattered across the
 * app: the spec's promise is that Momentum gets out of the way, and that only
 * works if "what needs deciding" has exactly one address.
 */
export default async function ReviewPage() {
  const { userId, zone } = await getSession()
  const ctx = { now: systemClock.now(), zone }
  const db = await getDb()

  const all = await listItems(userId)
  const buckets = groupByBucket(all, ctx)
  const untriaged = buckets.inbox

  const sources = await loadSourcesForItems(
    userId,
    untriaged.map((i) => i.id),
  )

  const pendingActions = await db
    .select()
    .from(proposedActions)
    .where(and(eq(proposedActions.userId, userId), eq(proposedActions.status, 'pending')))
    .orderBy(desc(proposedActions.createdAt))

  const pendingDrafts = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.userId, userId), eq(emailDrafts.status, 'drafted')))

  const needsReply = await db
    .select({
      threadId: emailThreads.id,
      subject: emailThreads.subject,
      participants: emailThreads.participants,
      summary: emailThreadSummaries.summary,
      confidence: emailThreadSummaries.confidence,
      sensitivity: emailThreads.sensitivity,
    })
    .from(emailThreadSummaries)
    .innerJoin(emailThreads, eq(emailThreadSummaries.threadId, emailThreads.id))
    .where(and(eq(emailThreadSummaries.userId, userId), eq(emailThreadSummaries.needsReply, true)))

  const nothingToReview =
    untriaged.length === 0 &&
    pendingActions.length === 0 &&
    pendingDrafts.length === 0 &&
    needsReply.length === 0

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Inbox &amp; Review"
        blurb="Everything waiting on your judgment, in one place. Nothing here has happened yet."
      />

      {nothingToReview ? (
        <EmptyState
          message="Nothing is waiting on you."
          hint="Suggestions, drafts, and untriaged captures all land here first."
        />
      ) : null}

      <Section title="Captured but not sorted" count={untriaged.length}>
        {untriaged.map((item) => (
          <div key={item.id}>
            <ItemCard item={item} ctx={ctx} sources={sources.get(item.id) ?? []} />
            <div className="mt-2 flex flex-wrap gap-2">
              <form action={promoteToTask}>
                <input type="hidden" name="itemId" value={item.id} />
                <button type="submit" className={SMALL_BUTTON}>
                  Keep as a task
                </button>
              </form>
              <form action={snoozeItemAction}>
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="days" value="7" />
                <button type="submit" className={SMALL_BUTTON}>
                  Later
                </button>
              </form>
              <form action={completeItemAction}>
                <input type="hidden" name="itemId" value={item.id} />
                <button type="submit" className={SMALL_BUTTON}>
                  Already done
                </button>
              </form>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Suggestions awaiting approval" count={pendingActions.length}>
        {pendingActions.map((action) => (
          <div key={action.id} className="rounded-card border border-line bg-surface p-4">
            <p className="font-medium text-ink">{action.actionType.replace(/_/g, ' ')}</p>
            <p className="mt-1 text-sm text-ink-muted">{action.summary}</p>
            <Link href="/talk" className="mt-2 inline-block text-sm text-accent hover:underline">
              Review in Talk →
            </Link>
          </div>
        ))}
      </Section>

      <Section title="Messages that look like they need a reply" count={needsReply.length}>
        {needsReply.map((thread) => (
          <div key={thread.threadId} className="rounded-card border border-line bg-surface p-4">
            <p className="font-medium text-ink">{thread.subject ?? '(no subject)'}</p>
            <p className="mt-1 text-sm text-ink-muted">{thread.summary}</p>
            <p className="mt-2 text-xs text-ink-faint">
              {thread.participants.join(', ')} · confidence: {thread.confidence}
              {thread.sensitivity === 'sensitive' ? ' · flagged for careful review' : ''}
            </p>
            <Link href="/drafts" className="mt-2 inline-block text-sm text-accent hover:underline">
              See the draft →
            </Link>
          </div>
        ))}
      </Section>

      <Section title="Drafts waiting for approval" count={pendingDrafts.length}>
        {pendingDrafts.map((draft) => (
          <Link
            key={draft.id}
            href="/drafts"
            className="block rounded-card border border-line bg-surface p-4 hover:bg-surface-sunken"
          >
            <p className="font-medium text-ink">{draft.subject}</p>
            <p className="mt-1 text-sm text-ink-muted">To {draft.toRecipients.join(', ')}</p>
          </Link>
        ))}
      </Section>
    </div>
  )
}
