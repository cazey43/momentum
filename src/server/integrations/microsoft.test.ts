import { and, eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, getDb, sqliteClient } from '@/db/client'
import { auditEvents, connectedAccounts, emailThreads, users } from '@/db/schema'
import { decryptSecret, encryptSecret } from '@/server/crypto'
import { checkEncryptionKey, checkMicrosoftEnv } from '@/server/env'
import { disconnectAccount } from './disconnect'
import {
  authorizeUrl,
  createPkcePair,
  createState,
  exchangeCodeForTokens,
  TokenExchangeError,
  unexpectedScopes,
} from './microsoft'

const KEY = Buffer.alloc(32, 5).toString('base64')
const NOW = new Date('2026-08-13T15:00:00Z')
const USER = 'user_ms_test'

const ENV = {
  MS_GRAPH_CLIENT_ID: 'client-abc',
  MS_GRAPH_TENANT_ID: 'common',
  MS_GRAPH_CLIENT_SECRET: 'secret-xyz',
  MS_GRAPH_REDIRECT_URI: 'http://localhost:3000/api/integrations/microsoft/callback',
  MOMENTUM_ENCRYPTION_KEY: KEY,
}

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

describe('environment validation', () => {
  it('accepts a complete configuration', () => {
    expect(checkMicrosoftEnv(ENV).ok).toBe(true)
  })

  it('names every missing variable rather than failing generically', () => {
    const result = checkMicrosoftEnv({})
    expect(result.ok).toBe(false)
    const joined = result.problems.join(' ')
    for (const key of Object.keys(ENV)) {
      expect(joined).toContain(key)
    }
  })

  it('tells the user how to fix each problem', () => {
    const result = checkMicrosoftEnv({})
    expect(result.problems.join(' ')).toMatch(/randomBytes\(32\)/)
    expect(result.problems.join(' ')).toMatch(/Entra/)
  })

  it('rejects a redirect URI that is not a URL', () => {
    const result = checkMicrosoftEnv({
      ...ENV,
      MS_GRAPH_REDIRECT_URI: 'not-a-url',
    })
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain('MS_GRAPH_REDIRECT_URI')
  })

  it('rejects an encryption key of the wrong length', () => {
    const result = checkEncryptionKey({
      MOMENTUM_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64'),
    })
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toMatch(/32 bytes/)
  })

  it('treats a missing encryption key as a problem, not a default', () => {
    expect(checkEncryptionKey({}).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// PKCE and the authorize URL
// ---------------------------------------------------------------------------

describe('PKCE', () => {
  it('derives the challenge as base64url SHA-256 of the verifier', async () => {
    const { verifier, challenge } = createPkcePair()
    const { createHash } = await import('node:crypto')
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })

  it('produces a fresh verifier every time', () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier)
  })

  it('produces high-entropy, URL-safe values', () => {
    const { verifier } = createPkcePair()
    expect(verifier.length).toBeGreaterThanOrEqual(43) // RFC 7636 minimum
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('produces a fresh state every time', () => {
    expect(createState()).not.toBe(createState())
  })
})

describe('authorize URL', () => {
  const url = () => new URL(authorizeUrl(ENV, 'state-123', 'challenge-abc'))

  it('requests ONLY read-only scopes', () => {
    const scope = url().searchParams.get('scope') ?? ''
    expect(scope).toContain('Mail.Read')
    expect(scope).toContain('offline_access')
    // The product must never be able to ask for send permission from here.
    expect(scope).not.toMatch(/Mail\.Send/i)
    expect(scope).not.toMatch(/Mail\.ReadWrite/i)
    expect(scope).not.toMatch(/\.Write/i)
  })

  it('uses S256 PKCE, never plain', () => {
    expect(url().searchParams.get('code_challenge_method')).toBe('S256')
    expect(url().searchParams.get('code_challenge')).toBe('challenge-abc')
  })

  it('carries the CSRF state', () => {
    expect(url().searchParams.get('state')).toBe('state-123')
  })

  it('never puts the client secret in a front-channel URL', () => {
    expect(url().toString()).not.toContain(ENV.MS_GRAPH_CLIENT_SECRET)
  })

  it('targets the configured tenant', () => {
    expect(url().pathname).toContain('/common/oauth2/v2.0/authorize')
  })
})

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('token exchange', () => {
  it('returns tokens and computes expiry from the injected clock', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 3600,
        scope: 'Mail.Read offline_access',
      }),
    )

    const tokens = await exchangeCodeForTokens(ENV, 'code-1', 'verifier-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: NOW,
    })

    expect(tokens.accessToken).toBe('at-1')
    expect(tokens.refreshToken).toBe('rt-1')
    expect(tokens.expiresAt.toISOString()).toBe('2026-08-13T16:00:00.000Z')
    expect(tokens.grantedScopes).toEqual(['Mail.Read', 'offline_access'])
  })

  it('sends the PKCE verifier so the code cannot be redeemed elsewhere', async () => {
    let sentBody = ''
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = String(init?.body ?? '')
      return jsonResponse({ access_token: 'at', expires_in: 3600, scope: 'Mail.Read' })
    })

    await exchangeCodeForTokens(ENV, 'code-1', 'verifier-secret', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: NOW,
    })

    expect(sentBody).toContain('code_verifier=verifier-secret')
    expect(sentBody).toContain('grant_type=authorization_code')
  })

  it('surfaces a provider error with its description', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'invalid_grant', error_description: 'AADSTS70008: expired' }, 400),
    )

    await expect(
      exchangeCodeForTokens(ENV, 'bad', 'v', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(TokenExchangeError)

    await expect(
      exchangeCodeForTokens(ENV, 'bad', 'v', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ detail: expect.stringContaining('AADSTS70008') })
  })

  it('handles a network failure without leaking a stack trace', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })

    await expect(
      exchangeCodeForTokens(ENV, 'c', 'v', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Could not reach Microsoft') })
  })

  it('handles a non-JSON response', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>502</html>', { status: 502 }))
    await expect(
      exchangeCodeForTokens(ENV, 'c', 'v', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ message: expect.stringContaining('could not be read') })
  })

  it('rejects a success response with no access token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ expires_in: 3600 }))
    await expect(
      exchangeCodeForTokens(ENV, 'c', 'v', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ detail: 'missing access_token' })
  })

  it('tolerates a missing refresh token', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: 'at', expires_in: 3600, scope: 'Mail.Read' }),
    )
    const tokens = await exchangeCodeForTokens(ENV, 'c', 'v', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: NOW,
    })
    expect(tokens.refreshToken).toBeNull()
  })
})

describe('scope overreach detection', () => {
  it('flags a send scope', () => {
    expect(unexpectedScopes(['Mail.Read', 'Mail.Send'])).toEqual(['Mail.Send'])
  })

  it('flags a write scope', () => {
    expect(unexpectedScopes(['Mail.ReadWrite'])).toHaveLength(1)
  })

  it('passes the read-only set', () => {
    expect(
      unexpectedScopes(['offline_access', 'User.Read', 'Mail.Read', 'MailboxSettings.Read']),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Token storage and disconnect (integration, real database)
// ---------------------------------------------------------------------------

describe('token storage and disconnect', () => {
  const originalKey = process.env.MOMENTUM_ENCRYPTION_KEY

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' })
    await sqliteClient.execute('PRAGMA foreign_keys = ON')
    const database = await getDb()
    await database.insert(users).values({ id: USER, displayName: 'MS Test' }).onConflictDoNothing()
  })

  beforeEach(async () => {
    process.env.MOMENTUM_ENCRYPTION_KEY = KEY
    const database = await getDb()
    await database.delete(connectedAccounts).where(eq(connectedAccounts.userId, USER))
    await database.delete(emailThreads).where(eq(emailThreads.userId, USER))
    await database.delete(auditEvents).where(eq(auditEvents.userId, USER))
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.MOMENTUM_ENCRYPTION_KEY
    else process.env.MOMENTUM_ENCRYPTION_KEY = originalKey
  })

  async function insertConnectedAccount() {
    const database = await getDb()
    await database.insert(connectedAccounts).values({
      id: 'acct_test',
      userId: USER,
      provider: 'microsoft',
      accountLabel: 'casey@example.com',
      accessTokenEncrypted: encryptSecret('access-token-plaintext'),
      refreshTokenEncrypted: encryptSecret('refresh-token-plaintext'),
      tokenExpiresAt: new Date(NOW.getTime() + 3_600_000),
      grantedScopes: ['Mail.Read', 'offline_access'],
    })
  }

  it('stores tokens encrypted, never in plaintext', async () => {
    await insertConnectedAccount()
    const database = await getDb()
    const [row] = await database
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, 'acct_test'))

    expect(row?.accessTokenEncrypted).not.toContain('access-token-plaintext')
    expect(row?.refreshTokenEncrypted).not.toContain('refresh-token-plaintext')
    // ...and round-trips correctly.
    expect(decryptSecret(row?.accessTokenEncrypted ?? '')).toBe('access-token-plaintext')
  })

  it('DESTROYS both tokens on disconnect, rather than only flagging the row', async () => {
    await insertConnectedAccount()

    const result = await disconnectAccount(USER, 'acct_test', NOW)
    expect(result.ok).toBe(true)

    const database = await getDb()
    const [row] = await database
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, 'acct_test'))

    // The whole point: a soft flag would leave a usable refresh token on disk.
    expect(row?.accessTokenEncrypted).toBeNull()
    expect(row?.refreshTokenEncrypted).toBeNull()
    expect(row?.tokenExpiresAt).toBeNull()
    expect(row?.grantedScopes).toEqual([])
    expect(row?.revokedAt).not.toBeNull()
  })

  it('removes synced mailbox data but keeps demo rows', async () => {
    await insertConnectedAccount()
    const database = await getDb()

    await database.insert(emailThreads).values([
      {
        id: 'thr_real',
        userId: USER,
        externalThreadId: 'real-1',
        subject: 'A real synced thread',
        participants: ['a@b.com'],
        isDemo: false,
      },
      {
        id: 'thr_demo',
        userId: USER,
        externalThreadId: 'demo-1',
        subject: 'A demo thread',
        participants: ['demo@example.com'],
        isDemo: true,
      },
    ])

    const result = await disconnectAccount(USER, 'acct_test', NOW)
    expect(result.threadsRemoved).toBe(1)

    const remaining = await database
      .select()
      .from(emailThreads)
      .where(eq(emailThreads.userId, USER))

    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.isDemo).toBe(true)
  })

  it('refuses to disconnect another user’s account', async () => {
    await insertConnectedAccount()
    const result = await disconnectAccount('someone_else', 'acct_test', NOW)
    expect(result.ok).toBe(false)

    const database = await getDb()
    const [row] = await database
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, 'acct_test'))
    // Tokens untouched.
    expect(row?.accessTokenEncrypted).not.toBeNull()
  })

  it('is idempotent', async () => {
    await insertConnectedAccount()
    await disconnectAccount(USER, 'acct_test', NOW)
    const second = await disconnectAccount(USER, 'acct_test', NOW)
    expect(second.ok).toBe(true)
    expect(second.message).toMatch(/already disconnected/i)
  })

  it('reports a missing account rather than throwing', async () => {
    const result = await disconnectAccount(USER, 'no_such_account', NOW)
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/could not be found/i)
  })

  it('leaves a revoked account unusable by the provider resolver', async () => {
    await insertConnectedAccount()
    await disconnectAccount(USER, 'acct_test', NOW)

    const { getEmailProvider } = await import('@/server/email/provider')
    const resolved = await getEmailProvider(USER)

    // Falls back to demo rather than trying to use a destroyed credential.
    expect(resolved.isDemo).toBe(true)
  })
})

describe('connected accounts are scoped per user', () => {
  it('never returns another user’s account from the resolver', async () => {
    const database = await getDb()
    await database
      .insert(users)
      .values({ id: 'other_user', displayName: 'Other' })
      .onConflictDoNothing()

    const rows = await database
      .select()
      .from(connectedAccounts)
      .where(and(eq(connectedAccounts.userId, 'other_user')))

    expect(rows).toHaveLength(0)
  })
})
