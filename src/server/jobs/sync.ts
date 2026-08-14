import { and, eq } from 'drizzle-orm'
import { systemClock } from '@/core/time/clock'
import { getDb } from '@/db/client'
import { emailThreads, syncCursors } from '@/db/schema'
import { getEmailProvider } from '@/server/email/provider'

export interface SyncResult {
  threadsSeen: number
  threadsInserted: number
  threadsUpdated: number
  isDemo: boolean
}

/**
 * Pulls thread metadata from the connected mailbox.
 *
 * Metadata only — subjects, participants, timestamps, read state. Message
 * bodies are fetched lazily, per thread, when a feature actually needs them.
 * That keeps the "store no more content than the feature requires" rule true
 * of the sync path rather than only of the storage layer.
 *
 * Upserts on (userId, externalThreadId), so re-running is safe and produces no
 * duplicates — which is what makes it safe to put on a timer.
 */
export async function syncEmailThreads(userId: string): Promise<SyncResult> {
  const db = await getDb()
  const now = systemClock.now()
  const { provider, isDemo } = await getEmailProvider(userId)

  const cursorRows = await db
    .select()
    .from(syncCursors)
    .where(and(eq(syncCursors.userId, userId), eq(syncCursors.resource, 'email_threads')))
    .limit(1)

  const cursor = cursorRows[0]
  // Overlap the window by a day so a thread that arrived mid-sync is not
  // skipped forever by a cursor that moved past it.
  const since = cursor?.lastSuccessAt
    ? new Date(cursor.lastSuccessAt.getTime() - 86_400_000)
    : undefined

  let threads: Awaited<ReturnType<typeof provider.listThreads>>
  try {
    threads = await provider.listThreads(since ? { since, limit: 100 } : { limit: 100 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync error'
    await upsertCursor(userId, { lastErrorAt: now, lastError: message })
    throw error
  }

  let inserted = 0
  let updated = 0

  for (const thread of threads) {
    const existing = await db
      .select({ id: emailThreads.id })
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.userId, userId),
          eq(emailThreads.externalThreadId, thread.externalThreadId),
        ),
      )
      .limit(1)

    if (existing[0]) {
      await db
        .update(emailThreads)
        .set({
          subject: thread.subject,
          participants: thread.participants,
          lastMessageAt: thread.lastMessageAt,
          lastMessageFromMe: thread.lastMessageFromMe,
          unread: thread.unread,
          category: thread.category,
          updatedAt: now,
        })
        .where(eq(emailThreads.id, existing[0].id))
      updated += 1
    } else {
      await db.insert(emailThreads).values({
        id: `thr_${userId}_${thread.externalThreadId}`.slice(0, 120),
        userId,
        externalThreadId: thread.externalThreadId,
        subject: thread.subject,
        participants: thread.participants,
        lastMessageAt: thread.lastMessageAt,
        lastMessageFromMe: thread.lastMessageFromMe,
        unread: thread.unread,
        category: thread.category,
        isDemo,
      })
      inserted += 1
    }
  }

  await upsertCursor(userId, { lastSuccessAt: now, lastErrorAt: null, lastError: null })

  return { threadsSeen: threads.length, threadsInserted: inserted, threadsUpdated: updated, isDemo }
}

async function upsertCursor(
  userId: string,
  values: {
    lastSuccessAt?: Date
    lastErrorAt?: Date | null
    lastError?: string | null
  },
): Promise<void> {
  const db = await getDb()
  const id = `cursor_${userId}_email_threads`

  await db
    .insert(syncCursors)
    .values({
      id,
      userId,
      accountId: null,
      resource: 'email_threads',
      ...values,
      updatedAt: systemClock.now(),
    })
    .onConflictDoUpdate({
      target: [syncCursors.userId, syncCursors.accountId, syncCursors.resource],
      set: { ...values, updatedAt: systemClock.now() },
    })
}
