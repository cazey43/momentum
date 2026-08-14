import { createHash, randomBytes } from 'node:crypto'
import { GRAPH_READ_SCOPES } from '@/adapters/email/graph'
import type { MicrosoftEnv } from '@/server/env'

/**
 * Microsoft OAuth 2.0 authorization-code flow with PKCE.
 *
 * Split into pure functions plus one injectable-fetch call, so the whole flow
 * is testable without credentials and without contacting Microsoft.
 *
 * Security properties, each covered by a test:
 * - **PKCE** — the code verifier never leaves this server, so an intercepted
 *   authorization code cannot be redeemed by anyone else.
 * - **State** — a random value round-trips through the redirect and is compared
 *   on return, which is what stops a CSRF-forged callback from silently
 *   attaching an attacker's mailbox to this account.
 * - **Least privilege** — the requested scope list is taken from the read-only
 *   adapter constant. `Mail.Send` is not requestable from here at all.
 */

export interface PkcePair {
  verifier: string
  challenge: string
}

/** RFC 7636 S256. The verifier is high-entropy and single-use. */
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function createState(): string {
  return randomBytes(24).toString('base64url')
}

export function authorizeUrl(env: MicrosoftEnv, state: string, challenge: string): string {
  const url = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(env.MS_GRAPH_TENANT_ID)}/oauth2/v2.0/authorize`,
  )

  url.searchParams.set('client_id', env.MS_GRAPH_CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', env.MS_GRAPH_REDIRECT_URI)
  url.searchParams.set('response_mode', 'query')
  // Read-only by construction — sourced from the adapter's own scope list.
  url.searchParams.set('scope', GRAPH_READ_SCOPES.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  // Force an account chooser so connecting a second mailbox is possible.
  url.searchParams.set('prompt', 'select_account')

  return url.toString()
}

export interface TokenSet {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
  grantedScopes: string[]
}

export class TokenExchangeError extends Error {
  readonly detail: string
  /**
   * True when retrying will never help — the grant itself is dead (revoked,
   * expired past its sliding window, password changed, consent withdrawn).
   *
   * The caller needs this distinction: a permanent failure means asking the
   * user to reconnect, while a transient one means trying again later. Treating
   * a network blip as permanent would disconnect people over a flaky Wi-Fi
   * moment; treating a revoked grant as transient would retry forever and never
   * tell them why nothing works.
   */
  readonly isPermanent: boolean

  constructor(message: string, detail: string, isPermanent = false) {
    super(message)
    this.name = 'TokenExchangeError'
    this.detail = detail
    this.isPermanent = isPermanent
  }
}

/**
 * OAuth error codes that mean the grant is unrecoverable.
 *
 * `interaction_required` and `consent_required` are included because both can
 * only be resolved by sending the user back through the consent screen.
 */
const PERMANENT_OAUTH_ERRORS = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
  'interaction_required',
  'consent_required',
])

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

export interface TokenRequestOptions {
  fetchImpl?: typeof fetch
  now?: Date
}

/**
 * Posts to the token endpoint and normalizes the outcome.
 *
 * Shared by the authorization-code and refresh grants so both classify errors
 * and compute expiry identically — a refresh that mis-parsed expiry would show
 * up much later as an inexplicably dead connection.
 */
async function requestTokens(
  env: MicrosoftEnv,
  body: URLSearchParams,
  failureMessage: string,
  options: TokenRequestOptions,
): Promise<TokenSet> {
  const doFetch = options.fetchImpl ?? fetch
  const now = options.now ?? new Date()

  let response: Response
  try {
    response = await doFetch(
      `https://login.microsoftonline.com/${encodeURIComponent(env.MS_GRAPH_TENANT_ID)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    )
  } catch (error) {
    // Network failures are always transient — never disconnect over one.
    throw new TokenExchangeError(
      'Could not reach Microsoft.',
      error instanceof Error ? error.message : 'network error',
      false,
    )
  }

  let payload: TokenResponse
  try {
    payload = (await response.json()) as TokenResponse
  } catch {
    throw new TokenExchangeError(
      'Microsoft returned a response that could not be read.',
      `status ${response.status}`,
      false,
    )
  }

  if (!response.ok || payload.error) {
    // error_description can carry a correlation id but never a secret, and it
    // is the single most useful thing for diagnosing a failure.
    throw new TokenExchangeError(
      failureMessage,
      payload.error_description ?? payload.error ?? `status ${response.status}`,
      payload.error ? PERMANENT_OAUTH_ERRORS.has(payload.error) : false,
    )
  }

  if (!payload.access_token) {
    throw new TokenExchangeError(
      'Microsoft did not return an access token.',
      'missing access_token',
      false,
    )
  }

  const expiresInSeconds = typeof payload.expires_in === 'number' ? payload.expires_in : 3600

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: new Date(now.getTime() + expiresInSeconds * 1000),
    grantedScopes: payload.scope ? payload.scope.split(' ').filter(Boolean) : [],
  }
}

/**
 * Redeems an authorization code for tokens.
 *
 * `now` and `fetchImpl` are injected so the whole path — including expiry
 * calculation and error handling — is deterministic under test.
 */
export async function exchangeCodeForTokens(
  env: MicrosoftEnv,
  code: string,
  verifier: string,
  options: TokenRequestOptions = {},
): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: env.MS_GRAPH_CLIENT_ID,
    client_secret: env.MS_GRAPH_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.MS_GRAPH_REDIRECT_URI,
    code_verifier: verifier,
    scope: GRAPH_READ_SCOPES.join(' '),
  })

  return requestTokens(env, body, 'Microsoft rejected the connection request.', options)
}

/**
 * Exchanges a refresh token for a fresh access token.
 *
 * Microsoft **rotates refresh tokens**: the response usually contains a new one
 * that replaces the old. Callers must persist `refreshToken` whenever it comes
 * back non-null, or the next refresh will present a superseded token and fail
 * permanently. That is the single easiest way to get this wrong, and it fails
 * silently until the current access token expires.
 */
export async function refreshAccessToken(
  env: MicrosoftEnv,
  refreshToken: string,
  options: TokenRequestOptions = {},
): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: env.MS_GRAPH_CLIENT_ID,
    client_secret: env.MS_GRAPH_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: GRAPH_READ_SCOPES.join(' '),
  })

  return requestTokens(env, body, 'Microsoft refused to renew the connection.', options)
}

/**
 * Verifies the granted scopes contain nothing beyond what was asked for.
 *
 * A tenant can, in principle, return more than was requested. If a send or
 * write scope ever comes back, that is worth surfacing rather than silently
 * holding a more powerful token than the product claims to use.
 */
const FORBIDDEN_SCOPE_PATTERN = /mail\.send|mail\.readwrite|\.write|full_access/i

export function unexpectedScopes(granted: readonly string[]): string[] {
  return granted.filter((scope) => FORBIDDEN_SCOPE_PATTERN.test(scope))
}
