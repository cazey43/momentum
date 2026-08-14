import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import {
  conversations,
  emailDrafts,
  emailThreads,
  items,
  messages,
  reminders,
  sourceRecords,
  userPreferences,
} from '@/db/schema'
import { checkRateLimit, RATE_LIMITS } from '@/server/ratelimit'
import { getSession } from '@/server/session'

export const dynamic = 'force-dynamic'

/**
 * Export-my-data.
 *
 * Returns everything held for the acting user as a single JSON document. The
 * query is scoped by session user id, so this endpoint cannot be used to read
 * another user's rows even if one existed.
 */
export async function GET(): Promise<Response> {
  const { userId } = await getSession()

  const limit = checkRateLimit(`${userId}:export`, RATE_LIMITS.export)
  if (!limit.allowed) {
    return new Response('Too many export requests. Try again shortly.', {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) },
    })
  }

  const db = await getDb()

  const [
    preferences,
    itemRows,
    sourceRows,
    conversationRows,
    messageRows,
    threadRows,
    draftRows,
    reminderRows,
  ] = await Promise.all([
    db.select().from(userPreferences).where(eq(userPreferences.userId, userId)),
    db.select().from(items).where(eq(items.userId, userId)),
    db.select().from(sourceRecords).where(eq(sourceRecords.userId, userId)),
    db.select().from(conversations).where(eq(conversations.userId, userId)),
    db.select().from(messages).where(eq(messages.userId, userId)),
    db.select().from(emailThreads).where(eq(emailThreads.userId, userId)),
    db.select().from(emailDrafts).where(eq(emailDrafts.userId, userId)),
    db.select().from(reminders).where(eq(reminders.userId, userId)),
  ])

  const payload = {
    exportedAt: new Date().toISOString(),
    userId,
    note: 'Everything Momentum holds for this user. Tokens are deliberately excluded.',
    preferences,
    items: itemRows,
    sourceRecords: sourceRows,
    conversations: conversationRows,
    messages: messageRows,
    emailThreads: threadRows,
    emailDrafts: draftRows,
    reminders: reminderRows,
  }

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="momentum-export.json"',
      // An export is personal data; never let an intermediary keep a copy.
      'Cache-Control': 'no-store, private',
    },
  })
}
