import { and, eq, isNull } from 'drizzle-orm'
import { DemoEmailProvider } from '@/adapters/email/demo'
import { GraphEmailProvider } from '@/adapters/email/graph'
import type { EmailProvider } from '@/core/ports/email'
import { getDb } from '@/db/client'
import { connectedAccounts } from '@/db/schema'
import { getValidAccessToken } from '@/server/integrations/tokens'

export interface ResolvedEmailProvider {
  provider: EmailProvider
  /** True when this is demo data rather than a real mailbox. */
  isDemo: boolean
  accountLabel: string
  /**
   * Set when a real account exists but could not be used right now. The UI
   * shows this instead of silently presenting demo data as the user's mail.
   */
  problem?: string
  /** True when only the user can fix it, by reconnecting. */
  needsReconnect?: boolean
}

/**
 * Resolves the email provider for a user.
 *
 * Obtains a *live* access token rather than reading the stored one directly:
 * tokens expire hourly, so anything constructed from the raw column would work
 * for an hour and then fail. `getValidAccessToken` renews transparently.
 *
 * Falls back to the demo mailbox when nothing usable is available, and always
 * reports which case occurred — presenting demo data as though it were the
 * user's real mail is exactly the kind of quiet dishonesty this product is
 * meant to avoid.
 */
export async function getEmailProvider(userId: string): Promise<ResolvedEmailProvider> {
  const db = await getDb()

  const accounts = await db
    .select()
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.provider, 'microsoft'),
        isNull(connectedAccounts.revokedAt),
      ),
    )
    .limit(1)

  const account = accounts[0]
  if (!account) {
    return { provider: new DemoEmailProvider(), isDemo: true, accountLabel: 'Demo mailbox' }
  }

  const token = await getValidAccessToken(userId)

  if (token.state === 'valid' || token.state === 'refreshed') {
    return {
      provider: new GraphEmailProvider({
        accessToken: token.accessToken as string,
        selfAddress: account.accountLabel,
      }),
      isDemo: false,
      accountLabel: account.accountLabel,
    }
  }

  return {
    provider: new DemoEmailProvider(),
    isDemo: true,
    accountLabel: 'Demo mailbox',
    problem:
      token.message ??
      'The connected account is not usable right now, so demo data is being shown.',
    needsReconnect: token.state === 'needs_reconnect',
  }
}
