import { and, eq, isNull } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { systemClock } from '@/core/time/clock'
import { getDb } from '@/db/client'
import { auditEvents, connectedAccounts } from '@/db/schema'
import { encryptSecret } from '@/server/crypto'
import { checkEncryptionKey, checkMicrosoftEnv } from '@/server/env'
import { newId } from '@/server/ids'
import {
  exchangeCodeForTokens,
  TokenExchangeError,
  unexpectedScopes,
} from '@/server/integrations/microsoft'
import { getSession } from '@/server/session'
import { OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE } from '../start/route'

export const dynamic = 'force-dynamic'

/**
 * Sends the user back to Settings with a readable message rather than JSON.
 *
 * The origin is taken from the incoming request: `NextResponse.redirect`
 * requires an absolute URL, and hardcoding one would break as soon as the app
 * ran on any host or port other than the assumed default.
 */
function backToSettings(request: Request, message: string, ok = false): Response {
  const url = new URL('/settings', new URL(request.url).origin)
  url.searchParams.set(ok ? 'connected' : 'connect_error', message)
  return NextResponse.redirect(url, { status: 303 })
}

/**
 * Completes the Microsoft connection.
 *
 * The order of checks is the security model:
 *   1. Provider-reported error — surface it, do nothing else.
 *   2. State must match the cookie — otherwise this is a forged callback.
 *   3. Encryption must be available *before* a token is obtained, so a token
 *      can never exist in memory with nowhere safe to put it.
 *   4. Exchange the code, then verify the granted scopes are read-only.
 */
export async function GET(request: Request): Promise<Response> {
  const { userId } = await getSession()
  const url = new URL(request.url)
  const jar = await cookies()

  const clearFlowCookies = () => {
    jar.delete(OAUTH_STATE_COOKIE)
    jar.delete(OAUTH_VERIFIER_COOKIE)
  }

  // 1. Microsoft told us it failed (consent declined, bad config, and so on).
  const providerError = url.searchParams.get('error')
  if (providerError) {
    clearFlowCookies()
    const description = url.searchParams.get('error_description') ?? providerError
    return backToSettings(request, `Microsoft did not complete the connection: ${description}`)
  }

  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  const expectedState = jar.get(OAUTH_STATE_COOKIE)?.value
  const verifier = jar.get(OAUTH_VERIFIER_COOKIE)?.value

  if (!code || !returnedState) {
    clearFlowCookies()
    return backToSettings(request, 'That callback was incomplete, so nothing was connected.')
  }

  // 2. CSRF check. A mismatch means this callback did not originate from a
  // connection this browser started.
  if (!expectedState || !verifier || returnedState !== expectedState) {
    clearFlowCookies()
    return backToSettings(
      request,
      'That connection attempt could not be verified, so it was refused. Start again from Settings.',
    )
  }

  // The cookies are single-use; burn them before any network call so a replayed
  // callback cannot reuse the same verifier.
  clearFlowCookies()

  // 3. Refuse to obtain a token we cannot store safely.
  const keyCheck = checkEncryptionKey()
  if (!keyCheck.ok) {
    return backToSettings(
      request,
      `Cannot store credentials safely, so the connection was stopped. ${keyCheck.problems[0] ?? ''}`,
    )
  }

  const env = checkMicrosoftEnv()
  if (!env.ok || !env.value) {
    return backToSettings(request, `Configuration is incomplete: ${env.problems.join(' ')}`)
  }

  // 4. Exchange.
  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>
  try {
    tokens = await exchangeCodeForTokens(env.value, code, verifier)
  } catch (error) {
    const detail = error instanceof TokenExchangeError ? error.detail : 'unexpected error'
    return backToSettings(request, `Could not complete the connection. ${detail}`)
  }

  const overreach = unexpectedScopes(tokens.grantedScopes)
  if (overreach.length > 0) {
    // A token with more power than the product claims to use is refused
    // outright rather than stored and quietly relied upon.
    return backToSettings(
      request,
      `The account granted more permission than Momentum asks for (${overreach.join(', ')}), so it was not connected.`,
    )
  }

  const db = await getDb()
  const now = systemClock.now()

  // Identify the mailbox so Settings can name it. A failure here is not fatal —
  // the connection still works, it just gets a generic label.
  let accountLabel = 'Microsoft account'
  try {
    const meResponse = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=userPrincipalName',
      {
        headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
      },
    )
    if (meResponse.ok) {
      const me = (await meResponse.json()) as { userPrincipalName?: string }
      if (me.userPrincipalName) accountLabel = me.userPrincipalName
    }
  } catch {
    // Keep the generic label.
  }

  const existing = await db
    .select()
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.provider, 'microsoft'),
        eq(connectedAccounts.accountLabel, accountLabel),
        isNull(connectedAccounts.revokedAt),
      ),
    )
    .limit(1)

  const values = {
    accessTokenEncrypted: encryptSecret(tokens.accessToken),
    refreshTokenEncrypted: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
    tokenExpiresAt: tokens.expiresAt,
    grantedScopes: tokens.grantedScopes,
    lastSyncError: null,
    revokedAt: null,
  }

  if (existing[0]) {
    await db.update(connectedAccounts).set(values).where(eq(connectedAccounts.id, existing[0].id))
  } else {
    await db.insert(connectedAccounts).values({
      id: newId('acct', now),
      userId,
      provider: 'microsoft',
      accountLabel,
      ...values,
    })
  }

  await db.insert(auditEvents).values({
    id: newId('audit_connect', now),
    userId,
    action: 'account_connected',
    resourceType: 'connected_account',
    resourceId: accountLabel,
    actor: 'user',
    // Scope names are not secrets and are exactly what a user would want to
    // audit later. The tokens themselves are never logged.
    metadata: { provider: 'microsoft', scopes: tokens.grantedScopes },
  })

  return backToSettings(request, `Connected ${accountLabel}. Read-only access.`, true)
}
