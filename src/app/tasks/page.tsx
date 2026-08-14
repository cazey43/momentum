import { ItemCard } from '@/components/ItemCard'
import { EmptyState, PageHeader, Section } from '@/components/PageHeader'
import { systemClock } from '@/core/time/clock'
import { groupByBucket, listItems } from '@/db/repositories/items'
import { loadSourcesForItems } from '@/db/repositories/sources'
import { getSession } from '@/server/session'

export const metadata = { title: 'Tasks' }

// Personal data, read fresh on every request; nothing here should be cached.
export const dynamic = 'force-dynamic'

export default async function TasksPage() {
  const { userId, zone } = await getSession()
  const ctx = { now: systemClock.now(), zone }

  const all = await listItems(userId)
  const sources = await loadSourcesForItems(
    userId,
    all.map((i) => i.id),
  )
  const buckets = groupByBucket(all, ctx)

  const activeCount =
    buckets.overdue.length + buckets.today.length + buckets.upcoming.length + buckets.inbox.length

  const render = (items: typeof all) =>
    items.map((item) => (
      <ItemCard key={item.id} item={item} ctx={ctx} sources={sources.get(item.id) ?? []} />
    ))

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Tasks" blurb="Everything you have committed to, in one place." />

      {activeCount === 0 && buckets.snoozed.length === 0 ? (
        <EmptyState
          message="Nothing is open right now."
          hint="Capture something with the quick-add field on Today, or connect an account in Settings."
        />
      ) : null}

      <Section title="Overdue" count={buckets.overdue.length} tone="urgent">
        {render(buckets.overdue)}
      </Section>

      <Section title="Today" count={buckets.today.length}>
        {render(buckets.today)}
      </Section>

      <Section title="Needs triage" count={buckets.inbox.length}>
        {render(buckets.inbox)}
      </Section>

      <Section title="Upcoming" count={buckets.upcoming.length}>
        {render(buckets.upcoming)}
      </Section>

      <Section title="Set aside" count={buckets.snoozed.length}>
        {render(buckets.snoozed)}
      </Section>

      <Section title="Someday" count={buckets.someday.length}>
        {render(buckets.someday)}
      </Section>

      <Section title="Completed" count={buckets.completed.length}>
        {render(buckets.completed)}
      </Section>
    </div>
  )
}
