'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { systemClock } from '@/core/time/clock'
import { getDb } from '@/db/client'
import { transitionItem } from '@/db/repositories/items'
import { auditEvents, items } from '@/db/schema'
import { getSession } from '@/server/session'

function revalidateAll() {
  revalidatePath('/loose-ends')
  revalidatePath('/')
  revalidatePath('/tasks')
  revalidatePath('/waiting')
}

/** "I handled this already." */
export async function resolveLooseEnd(formData: FormData): Promise<void> {
  const itemId = String(formData.get('itemId') ?? '')
  if (!itemId) return

  const { userId, zone } = await getSession()
  await transitionItem(userId, itemId, { type: 'complete' }, { now: systemClock.now(), zone })
  revalidateAll()
}

/** "Not now" — an explicit deferral the engine must respect immediately. */
export async function snoozeLooseEnd(formData: FormData): Promise<void> {
  const itemId = String(formData.get('itemId') ?? '')
  const days = Number(formData.get('days') ?? 3)
  if (!itemId || !Number.isFinite(days) || days <= 0) return

  const { userId, zone } = await getSession()
  const now = systemClock.now()
  await transitionItem(
    userId,
    itemId,
    { type: 'snooze', until: new Date(now.getTime() + days * 86_400_000) },
    { now, zone },
  )
  revalidateAll()
}

/** "This isn't relevant" — stop surfacing it, but keep the record. */
export async function markNotRelevant(formData: FormData): Promise<void> {
  const itemId = String(formData.get('itemId') ?? '')
  if (!itemId) return

  const { userId } = await getSession()
  const db = await getDb()
  const now = systemClock.now()

  await db
    .update(items)
    .set({ remindersMuted: true, updatedAt: now, lastEngagedAt: now })
    .where(and(eq(items.id, itemId), eq(items.userId, userId)))

  await db.insert(auditEvents).values({
    id: `audit_notrel_${itemId}_${now.getTime()}`,
    userId,
    action: 'marked_not_relevant',
    resourceType: 'item',
    resourceId: itemId,
    actor: 'user',
    // Recording the correction is what would let detection improve later.
    metadata: { feedback: 'not_relevant' },
  })

  revalidateAll()
}

/** "Drop it entirely." */
export async function dismissLooseEnd(formData: FormData): Promise<void> {
  const itemId = String(formData.get('itemId') ?? '')
  if (!itemId) return

  const { userId, zone } = await getSession()
  await transitionItem(userId, itemId, { type: 'dismiss' }, { now: systemClock.now(), zone })
  revalidateAll()
}

/** "Turn this into a real task." */
export async function promoteToTask(formData: FormData): Promise<void> {
  const itemId = String(formData.get('itemId') ?? '')
  if (!itemId) return

  const { userId, zone } = await getSession()
  const result = await transitionItem(
    userId,
    itemId,
    { type: 'triage', to: 'open' },
    { now: systemClock.now(), zone },
  )

  // Already triaged is fine — the user's intent is satisfied either way.
  if (!result.ok) {
    const db = await getDb()
    await db
      .update(items)
      .set({ status: 'open', updatedAt: systemClock.now() })
      .where(and(eq(items.id, itemId), eq(items.userId, userId)))
  }

  revalidateAll()
}
