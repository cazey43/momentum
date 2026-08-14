'use server'

import { revalidatePath } from 'next/cache'
import { computeDedupeKey } from '@/core/domain/items'
import type { ItemKind } from '@/core/domain/vocabulary'
import { systemClock } from '@/core/time/clock'
import { createItem, transitionItem } from '@/db/repositories/items'
import { getSession } from '@/server/session'

/**
 * Quick capture.
 *
 * Deliberately dumb and instant: it records what the user typed as an inbox
 * item and gets out of the way. No model call, so capture never fails or
 * stalls because a provider is slow. Classification happens later, during
 * review, where the user can see and correct it.
 */
export async function quickCapture(formData: FormData): Promise<void> {
  const raw = String(formData.get('capture') ?? '').trim()
  if (!raw) return

  const { userId, zone } = await getSession()
  const now = systemClock.now()

  // A leading marker lets power users state the kind; everything else is a task.
  let kind: ItemKind = 'task'
  let title = raw
  const match = /^(waiting|delegated|note|someday|idea)\s*[:—-]\s*(.+)$/i.exec(raw)
  if (match?.[1] && match[2]) {
    const marker = match[1].toLowerCase()
    kind =
      marker === 'waiting'
        ? 'waiting_for'
        : marker === 'delegated'
          ? 'delegated'
          : marker === 'note'
            ? 'note'
            : 'someday'
    title = match[2]
  }

  await createItem({
    id: `item_${now.getTime().toString(36)}`,
    userId,
    kind,
    title: title.slice(0, 200),
    status: 'inbox',
    origin: 'user',
    dedupeKey: computeDedupeKey({ kind, title, zone }),
  })

  revalidatePath('/')
  revalidatePath('/tasks')
}

export async function completeItemAction(formData: FormData): Promise<void> {
  const itemId = String(formData.get('itemId') ?? '')
  if (!itemId) return

  const { userId, zone } = await getSession()
  await transitionItem(userId, itemId, { type: 'complete' }, { now: systemClock.now(), zone })

  revalidatePath('/')
  revalidatePath('/tasks')
}

export async function snoozeItemAction(formData: FormData): Promise<void> {
  const itemId = String(formData.get('itemId') ?? '')
  const days = Number(formData.get('days') ?? 1)
  if (!itemId || !Number.isFinite(days) || days <= 0) return

  const { userId, zone } = await getSession()
  const now = systemClock.now()
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

  await transitionItem(userId, itemId, { type: 'snooze', until }, { now, zone })

  revalidatePath('/')
  revalidatePath('/tasks')
}
