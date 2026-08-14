import { eq } from 'drizzle-orm'
import { DEMO_USER_ID } from '@/config/demo'
import { getDb } from '@/db/client'
import { userPreferences } from '@/db/schema'

export interface Session {
  userId: string
  zone: string
}

/**
 * Resolves the acting user.
 *
 * This release is local and single-user, so the session is the demo user. It
 * is still routed through a function that every server action calls, so that
 * introducing real authentication later is one edit here rather than a hunt
 * for hardcoded ids across the codebase.
 *
 * Callers must treat the returned userId as the *only* source of ownership —
 * never a user id supplied by the client.
 */
export async function getSession(): Promise<Session> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, DEMO_USER_ID))
    .limit(1)

  return {
    userId: DEMO_USER_ID,
    zone: rows[0]?.timezone ?? 'America/Detroit',
  }
}
