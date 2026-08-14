import { ItemCard } from '@/components/ItemCard'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { daysWaiting } from '@/core/domain/items'
import { systemClock } from '@/core/time/clock'
import { groupByBucket, listItems } from '@/db/repositories/items'
import { loadSourcesForItems } from '@/db/repositories/sources'
import { getSession } from '@/server/session'

export const metadata = { title: 'Waiting For' }

export const dynamic = 'force-dynamic'

export default async function WaitingPage() {
  const { userId, zone } = await getSession()
  const ctx = { now: systemClock.now(), zone }

  const all = await listItems(userId)
  const waiting = groupByBucket(all, ctx).waiting

  const sources = await loadSourcesForItems(
    userId,
    waiting.map((i) => i.id),
  )

  // Longest silence first — that is the one most likely to have been forgotten
  // by the other person, and the one a gentle nudge would most help.
  const ordered = [...waiting].sort((a, b) => daysWaiting(b, ctx) - daysWaiting(a, ctx))

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Waiting For"
        blurb="People and answers you are waiting on. Nothing here is your fault or your next action."
      />

      {ordered.length === 0 ? (
        <EmptyState
          message="You are not waiting on anyone right now."
          hint="Items appear here when you delegate something or are owed a reply."
        />
      ) : (
        <div className="space-y-3">
          {ordered.map((item) => (
            <ItemCard key={item.id} item={item} ctx={ctx} sources={sources.get(item.id) ?? []} />
          ))}
        </div>
      )}
    </div>
  )
}
