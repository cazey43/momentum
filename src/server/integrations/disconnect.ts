import { and, eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { auditEvents, connectedAccounts, emailThreads, syncCursors } from '@/db/schema'
import { newId } from '@/server/ids'

export interface DisconnectResult {
  ok: boolean
  message: string
  /** Rows whose stored copy of mailbox data was removed. */
  threadsRemoved: number
}

/**
 * Disconnects an account and destroys its credentials.
 *
 * "Revoked" here means the stored tokens are **overwritten with null**, not
 * merely flagged. A soft flag would leave a usable refresh token on disk, so
 * the disconnect button would be a lie.
 *
 * Synced mailbox metadata is deleted too. Demo rows are kept, since they are
 * not derived from the connected account and removing them would empty the app
 * for no reason.
 *
 * Note this cannot invalidate the token at Microsoft's end — only the user can
 * do that, from their account's app-permissions page. The UI says so rather
 * than implying a fuller revocation than actually happened.
 */
export async function disconnectAccount(
  userId: string,
  accountId: string,
  now: Date,
): Promise<DisconnectResult> {
  const db = await getDb()

  const rows = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.id, accountId), eq(connectedAccounts.userId, userId)))
    .limit(1)

  const account = rows[0]
  if (!account) {
    return { ok: false, message: 'That account could not be found.', threadsRemoved: 0 }
  }

  if (account.revokedAt) {
    return { ok: true, message: 'That account was already disconnected.', threadsRemoved: 0 }
  }

  // Destroy the credentials first. If anything later in this function fails,
  // the tokens are already gone, which is the safe direction to fail in.
  await db
    .update(connectedAccounts)
    .set({
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
      grantedScopes: [],
      revokedAt: now,
      lastSyncError: null,
    })
    .where(and(eq(connectedAccounts.id, accountId), eq(connectedAccounts.userId, userId)))

  const synced = await db
    .delete(emailThreads)
    .where(and(eq(emailThreads.userId, userId), eq(emailThreads.isDemo, false)))
    .returning({ id: emailThreads.id })

  await db
    .delete(syncCursors)
    .where(and(eq(syncCursors.userId, userId), eq(syncCursors.resource, 'email_threads')))

  await db.insert(auditEvents).values({
    id: newId('audit_disconnect', now),
    userId,
    action: 'account_disconnected',
    resourceType: 'connected_account',
    resourceId: accountId,
    actor: 'user',
    metadata: { provider: account.provider, threadsRemoved: synced.length },
  })

  return {
    ok: true,
    message: `Disconnected ${account.accountLabel}. Stored credentials were destroyed and ${synced.length} synced ${synced.length === 1 ? 'thread' : 'threads'} removed.`,
    threadsRemoved: synced.length,
  }
}
