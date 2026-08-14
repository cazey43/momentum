'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { systemClock } from '@/core/time/clock'
import { getDb } from '@/db/client'
import { proposedActions } from '@/db/schema'
import { applyProposedAction } from '@/server/ai/actions'
import { respondToMessage } from '@/server/ai/chat'
import { proposedActionSchema } from '@/server/ai/schemas'
import { checkRateLimit, RATE_LIMITS } from '@/server/ratelimit'
import { getSession } from '@/server/session'

/**
 * Server actions for the Talk view.
 *
 * Each one resolves the session server-side and never accepts a user id from
 * the client. The proposal id is the only thing the browser supplies, and it
 * is always re-read scoped to the session's user before anything happens.
 */

export async function sendChatMessage(formData: FormData): Promise<void> {
  const text = String(formData.get('message') ?? '').trim()
  if (!text) return

  const conversationId = formData.get('conversationId')
  const { userId, zone } = await getSession()

  // Guards against a stuck retry loop burning through API credit.
  const limit = checkRateLimit(`${userId}:model`, RATE_LIMITS.modelCall)
  if (!limit.allowed) return

  await respondToMessage(
    userId,
    { now: systemClock.now(), zone },
    typeof conversationId === 'string' && conversationId ? conversationId : null,
    text.slice(0, 4000),
  )

  revalidatePath('/talk')
}

export async function approveProposedAction(formData: FormData): Promise<void> {
  const id = String(formData.get('actionId') ?? '')
  if (!id) return

  const { userId, zone } = await getSession()
  const db = await getDb()

  const rows = await db
    .select()
    .from(proposedActions)
    .where(and(eq(proposedActions.id, id), eq(proposedActions.userId, userId)))
    .limit(1)

  const row = rows[0]
  if (row?.status !== 'pending') return

  // Re-validate the stored payload before executing. It was validated when
  // written, but re-checking means a row edited by any other path cannot
  // become an execution vector.
  const parsed = proposedActionSchema.safeParse(row.payload)
  if (!parsed.success) {
    await db
      .update(proposedActions)
      .set({ status: 'rejected', resolvedAt: systemClock.now() })
      .where(eq(proposedActions.id, id))
    revalidatePath('/talk')
    return
  }

  const outcome = await applyProposedAction(userId, parsed.data, {
    now: systemClock.now(),
    zone,
  })

  await db
    .update(proposedActions)
    .set({
      status: outcome.ok ? 'approved' : 'rejected',
      resolvedAt: systemClock.now(),
    })
    .where(eq(proposedActions.id, id))

  revalidatePath('/talk')
  revalidatePath('/tasks')
  revalidatePath('/')
}

export async function dismissProposedAction(formData: FormData): Promise<void> {
  const id = String(formData.get('actionId') ?? '')
  if (!id) return

  const { userId } = await getSession()
  const db = await getDb()

  await db
    .update(proposedActions)
    .set({ status: 'rejected', resolvedAt: systemClock.now() })
    .where(and(eq(proposedActions.id, id), eq(proposedActions.userId, userId)))

  revalidatePath('/talk')
}
