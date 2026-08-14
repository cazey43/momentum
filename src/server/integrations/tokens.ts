import { and, eq, isNull } from 'drizzle-orm'
import { systemClock } from '@/core/time/clock'
import { getDb } from '@/db/client'
import { connectedAccounts } from '@/db/schema'
import { decryptSecret, encryptSecret } from '@/server/crypto'
import { checkMicrosoftEnv } from '@/server/env'
import { refreshAccessToken, TokenExchangeError } from './microsoft'

/**
 * Access-token lifecycle.
 *
 * A Microsoft access token lives about an hour. Without renewal a connection
 * quietly stops working shortly after it is made, which is worse than not
 * connecting at all — the UI would keep claiming to be connected while every
 * request failed.
 *
 * Three things this module gets right, each of which is a common way to get
 * refresh wrong:
 *
 *   1. **Refresh early.** Tokens are renewed while still valid, using a skew
 *      window. Waiting for an actual 401 means at least one user-visible
 *      failure per hour.
 *   2. **Persist the rotated refresh token.** Microsoft returns a *new* refresh
 *      token on most renewals. Failing to store it means the next refresh
 *      presents a superseded token and dies permanently — an hour later, with
 *      no obvious cause.
 *   3. **Refresh once, not once per caller.** Concurrent jobs would otherwise
 *      each fire their own refresh; because rotation invalidates the previous
 *      token, the slower responses can invalidate the token the faster one just
 *      stored. Requests are de-duplicated per account.
 */

/** Renew this long before actual expiry. */
export const REFRESH_SKEW_MS = 5 * 60_000

export type TokenState =
  | 'valid' // the stored token is still good
  | 'refreshed' // renewed just now
  | 'not_connected' // no active account
  | 'needs_reconnect' // the grant is dead; only the user can fix it
  | 'temporarily_unavailable' // transient failure, worth retrying

export interface TokenResult {
  state: TokenState
  accessToken?: string
  accountId?: string
  /** Written for the user, safe to render. */
  message?: string
}

/**
 * True when a token should be renewed now.
 *
 * A null expiry is treated as expired: an unknown expiry is not a reason to
 * assume validity.
 */
export function needsRefresh(
  expiresAt: Date | null,
  now: Date,
  skewMs: number = REFRESH_SKEW_MS,
): boolean {
  if (!expiresAt) return true
  return expiresAt.getTime() - skewMs <= now.getTime()
}

/**
 * In-flight refreshes, keyed by account id.
 *
 * Module-level, which is the correct scope here: one process, one SQLite file.
 * A multi-process deployment would need a database lock instead, and the
 * rotation hazard makes that a real requirement rather than an optimisation.
 */
const inFlight = new Map<string, Promise<TokenResult>>()

export interface GetTokenOptions {
  fetchImpl?: typeof fetch
  now?: Date
  skewMs?: number
}

/**
 * Returns a usable access token for the user's connected Microsoft account,
 * renewing it first if necessary.
 *
 * Never throws for an expected condition — callers get a state to act on. A
 * dead grant is a normal thing that happens when someone changes their
 * password, not an exception.
 */
export async function getValidAccessToken(
  userId: string,
  options: GetTokenOptions = {},
): Promise<TokenResult> {
  const now = options.now ?? systemClock.now()
  const skewMs = options.skewMs ?? REFRESH_SKEW_MS
  const db = await getDb()

  const rows = await db
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

  const account = rows[0]
  if (!account) {
    return { state: 'not_connected' }
  }

  if (!account.accessTokenEncrypted) {
    // The account is still listed but its credentials are gone — which happens
    // after a permanent refresh failure clears them. Reporting `not_connected`
    // here would lose the distinction between "never connected" and "connected,
    // then broke", and the user would never be told to reconnect.
    return {
      state: 'needs_reconnect',
      accountId: account.id,
      message: account.lastSyncError ?? 'Sign-in expired. Reconnect the account to continue.',
    }
  }

  if (!needsRefresh(account.tokenExpiresAt, now, skewMs)) {
    try {
      return {
        state: 'valid',
        accessToken: decryptSecret(account.accessTokenEncrypted),
        accountId: account.id,
      }
    } catch {
      // Undecryptable means the encryption key changed. The stored token is
      // unusable and cannot be recovered, so say so plainly.
      return {
        state: 'needs_reconnect',
        accountId: account.id,
        message:
          'Stored credentials could not be read — the encryption key has changed. Reconnect the account.',
      }
    }
  }

  // De-duplicate concurrent refreshes for this account.
  const existing = inFlight.get(account.id)
  if (existing) return existing

  const attempt = performRefresh(
    userId,
    account.id,
    account.refreshTokenEncrypted,
    options,
    now,
  ).finally(() => {
    inFlight.delete(account.id)
  })

  inFlight.set(account.id, attempt)
  return attempt
}

async function performRefresh(
  userId: string,
  accountId: string,
  refreshTokenEncrypted: string | null,
  options: GetTokenOptions,
  now: Date,
): Promise<TokenResult> {
  const db = await getDb()

  if (!refreshTokenEncrypted) {
    // Connected without offline_access, so renewal was never possible.
    await markProblem(userId, accountId, 'Sign-in expired. Reconnect to continue.', true)
    return {
      state: 'needs_reconnect',
      accountId,
      message: 'Sign-in expired and there is no refresh token. Reconnect the account.',
    }
  }

  const env = checkMicrosoftEnv()
  if (!env.ok || !env.value) {
    return {
      state: 'temporarily_unavailable',
      accountId,
      message: `Cannot renew the connection: ${env.problems.join(' ')}`,
    }
  }

  let refreshToken: string
  try {
    refreshToken = decryptSecret(refreshTokenEncrypted)
  } catch {
    await markProblem(userId, accountId, 'Stored credentials could not be read.', true)
    return {
      state: 'needs_reconnect',
      accountId,
      message:
        'Stored credentials could not be read — the encryption key has changed. Reconnect the account.',
    }
  }

  try {
    const tokens = await refreshAccessToken(env.value, refreshToken, {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      now,
    })

    await db
      .update(connectedAccounts)
      .set({
        accessTokenEncrypted: encryptSecret(tokens.accessToken),
        // Only overwrite when a new one came back. Microsoft usually rotates,
        // but on the occasions it does not, blanking the stored token would
        // destroy the only means of renewing again.
        ...(tokens.refreshToken
          ? { refreshTokenEncrypted: encryptSecret(tokens.refreshToken) }
          : {}),
        tokenExpiresAt: tokens.expiresAt,
        ...(tokens.grantedScopes.length > 0 ? { grantedScopes: tokens.grantedScopes } : {}),
        lastSyncError: null,
      })
      .where(and(eq(connectedAccounts.id, accountId), eq(connectedAccounts.userId, userId)))

    return { state: 'refreshed', accessToken: tokens.accessToken, accountId }
  } catch (error) {
    const permanent = error instanceof TokenExchangeError && error.isPermanent
    const detail = error instanceof TokenExchangeError ? error.detail : 'unexpected error'

    await markProblem(
      userId,
      accountId,
      permanent ? 'Sign-in expired. Reconnect to continue.' : `Could not renew: ${detail}`,
      permanent,
    )

    return permanent
      ? {
          state: 'needs_reconnect',
          accountId,
          message: 'Sign-in expired. Reconnect the account to continue.',
        }
      : {
          state: 'temporarily_unavailable',
          accountId,
          message: `Could not renew the connection just now. ${detail}`,
        }
  }
}

/**
 * Records a problem against the account.
 *
 * On a permanent failure the tokens are cleared: they are provably useless, and
 * keeping dead credentials on disk is liability without benefit. `revokedAt`
 * stays null so the account still appears in Settings, flagged as needing
 * reconnection rather than silently vanishing.
 */
async function markProblem(
  userId: string,
  accountId: string,
  message: string,
  permanent: boolean,
): Promise<void> {
  const db = await getDb()

  await db
    .update(connectedAccounts)
    .set(
      permanent
        ? {
            lastSyncError: message,
            accessTokenEncrypted: null,
            refreshTokenEncrypted: null,
            tokenExpiresAt: null,
          }
        : { lastSyncError: message },
    )
    .where(and(eq(connectedAccounts.id, accountId), eq(connectedAccounts.userId, userId)))
}

/** Test seam: clears any in-flight refresh state between cases. */
export function resetInFlightRefreshes(): void {
  inFlight.clear()
}
