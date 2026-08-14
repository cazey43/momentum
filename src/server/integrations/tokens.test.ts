import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, getDb, sqliteClient } from '@/db/client'
import { connectedAccounts, users } from '@/db/schema'
import { decryptSecret, encryptSecret } from '@/server/crypto'
import {
  getValidAccessToken,
  needsRefresh,
  REFRESH_SKEW_MS,
  resetInFlightRefreshes,
} from './tokens'

const KEY = Buffer.alloc(32, 11).toString('base64')
const USER = 'user_token_test'
const ACCOUNT = 'acct_token_test'
const NOW = new Date('2026-08-13T15:00:00Z')

const ENV = {
  MS_GRAPH_CLIENT_ID: 'client-abc',
  MS_GRAPH_TENANT_ID: 'common',
  MS_GRAPH_CLIENT_SECRET: 'secret-xyz',
  MS_GRAPH_REDIRECT_URI: 'http://localhost:3000/api/integrations/microsoft/callback',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** A token endpoint that hands out a fresh, rotated pair each call. */
function rotatingEndpoint() {
  let call = 0
  const bodies: string[] = []
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    call += 1
    bodies.push(String(init?.body ?? ''))
    return jsonResponse({
      access_token: `access-${call}`,
      refresh_token: `refresh-${call}`,
      expires_in: 3600,
      scope: 'Mail.Read offline_access',
    })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, bodies, calls: () => call }
}

async function seedAccount(overrides: Record<string, unknown> = {}) {
  const database = await getDb()
  await database.delete(connectedAccounts).where(eq(connectedAccounts.userId, USER))
  await database.insert(connectedAccounts).values({
    id: ACCOUNT,
    userId: USER,
    provider: 'microsoft',
    accountLabel: 'casey@example.com',
    accessTokenEncrypted: encryptSecret('stored-access-token'),
    refreshTokenEncrypted: encryptSecret('stored-refresh-token'),
    // Expired by default, so most tests exercise the refresh path.
    tokenExpiresAt: new Date(NOW.getTime() - 60_000),
    grantedScopes: ['Mail.Read', 'offline_access'],
    ...overrides,
  })
}

async function readAccount() {
  const database = await getDb()
  const [row] = await database
    .select()
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, ACCOUNT))
  return row
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
  await sqliteClient.execute('PRAGMA foreign_keys = ON')
  const database = await getDb()
  await database.insert(users).values({ id: USER, displayName: 'Token Test' }).onConflictDoNothing()
})

beforeEach(() => {
  process.env.MOMENTUM_ENCRYPTION_KEY = KEY
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value
  resetInFlightRefreshes()
})

afterEach(() => {
  for (const key of Object.keys(ENV)) delete process.env[key]
})

// ---------------------------------------------------------------------------

describe('needsRefresh', () => {
  it('is false for a token comfortably in date', () => {
    expect(needsRefresh(new Date(NOW.getTime() + 3_600_000), NOW)).toBe(false)
  })

  it('is true once expired', () => {
    expect(needsRefresh(new Date(NOW.getTime() - 1), NOW)).toBe(true)
  })

  it('renews EARLY, inside the skew window', () => {
    // Waiting for real expiry guarantees at least one user-visible failure per
    // hour, because a request in flight can outlive the token.
    const justInsideSkew = new Date(NOW.getTime() + REFRESH_SKEW_MS - 1000)
    expect(needsRefresh(justInsideSkew, NOW)).toBe(true)

    const justOutsideSkew = new Date(NOW.getTime() + REFRESH_SKEW_MS + 1000)
    expect(needsRefresh(justOutsideSkew, NOW)).toBe(false)
  })

  it('treats an unknown expiry as needing refresh', () => {
    expect(needsRefresh(null, NOW)).toBe(true)
  })
})

describe('when the stored token is still valid', () => {
  it('returns it without contacting Microsoft', async () => {
    await seedAccount({ tokenExpiresAt: new Date(NOW.getTime() + 3_600_000) })
    const endpoint = rotatingEndpoint()

    const result = await getValidAccessToken(USER, { now: NOW, fetchImpl: endpoint.fetchImpl })

    expect(result.state).toBe('valid')
    expect(result.accessToken).toBe('stored-access-token')
    expect(endpoint.calls()).toBe(0)
  })
})

describe('refreshing', () => {
  it('renews an expired token and returns the new one', async () => {
    await seedAccount()
    const endpoint = rotatingEndpoint()

    const result = await getValidAccessToken(USER, { now: NOW, fetchImpl: endpoint.fetchImpl })

    expect(result.state).toBe('refreshed')
    expect(result.accessToken).toBe('access-1')
    expect(endpoint.calls()).toBe(1)
  })

  it('sends the refresh_token grant, not an authorization code', async () => {
    await seedAccount()
    const endpoint = rotatingEndpoint()

    await getValidAccessToken(USER, { now: NOW, fetchImpl: endpoint.fetchImpl })

    expect(endpoint.bodies[0]).toContain('grant_type=refresh_token')
    expect(endpoint.bodies[0]).toContain('refresh_token=stored-refresh-token')
    expect(endpoint.bodies[0]).not.toContain('code_verifier')
  })

  it('PERSISTS the rotated refresh token', async () => {
    // Microsoft returns a new refresh token on most renewals. Not storing it
    // means the next refresh presents a superseded token and fails for good.
    await seedAccount()
    const endpoint = rotatingEndpoint()

    await getValidAccessToken(USER, { now: NOW, fetchImpl: endpoint.fetchImpl })

    const row = await readAccount()
    expect(decryptSecret(row?.refreshTokenEncrypted ?? '')).toBe('refresh-1')
    expect(decryptSecret(row?.accessTokenEncrypted ?? '')).toBe('access-1')
  })

  it('keeps the existing refresh token when none is returned', async () => {
    // Rotation is usual but not guaranteed. Blanking it would destroy the only
    // means of ever renewing again.
    await seedAccount()
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: 'access-only', expires_in: 3600 }),
    ) as unknown as typeof fetch

    await getValidAccessToken(USER, { now: NOW, fetchImpl })

    const row = await readAccount()
    expect(decryptSecret(row?.refreshTokenEncrypted ?? '')).toBe('stored-refresh-token')
  })

  it('stores the new expiry so the next call does not refresh again', async () => {
    await seedAccount()
    const endpoint = rotatingEndpoint()

    await getValidAccessToken(USER, { now: NOW, fetchImpl: endpoint.fetchImpl })
    const second = await getValidAccessToken(USER, { now: NOW, fetchImpl: endpoint.fetchImpl })

    expect(second.state).toBe('valid')
    expect(endpoint.calls()).toBe(1)
  })

  it('encrypts the renewed tokens at rest', async () => {
    await seedAccount()
    const endpoint = rotatingEndpoint()

    await getValidAccessToken(USER, { now: NOW, fetchImpl: endpoint.fetchImpl })

    const row = await readAccount()
    expect(row?.accessTokenEncrypted).not.toContain('access-1')
    expect(row?.refreshTokenEncrypted).not.toContain('refresh-1')
  })

  it('clears a previous error after a successful renewal', async () => {
    await seedAccount({ lastSyncError: 'Could not renew: network error' })
    const endpoint = rotatingEndpoint()

    await getValidAccessToken(USER, { now: NOW, fetchImpl: endpoint.fetchImpl })

    expect((await readAccount())?.lastSyncError).toBeNull()
  })
})

describe('concurrent refreshes', () => {
  it('refreshes ONCE for simultaneous callers', async () => {
    // Rotation makes this a correctness issue, not just efficiency: two
    // parallel refreshes each invalidate the other's token, and whichever
    // response is stored last may already be dead.
    await seedAccount()
    const endpoint = rotatingEndpoint()

    const results = await Promise.all([
      getValidAccessToken(USER, { now: NOW, fetchImpl: endpoint.fetchImpl }),
      getValidAccessToken(USER, { now: NOW, fetchImpl: endpoint.fetchImpl }),
      getValidAccessToken(USER, { now: NOW, fetchImpl: endpoint.fetchImpl }),
    ])

    expect(endpoint.calls()).toBe(1)
    expect(results.map((r) => r.accessToken)).toEqual(['access-1', 'access-1', 'access-1'])
  })

  it('allows a fresh refresh after the in-flight one settles', async () => {
    await seedAccount()
    const endpoint = rotatingEndpoint()

    await getValidAccessToken(USER, { now: NOW, fetchImpl: endpoint.fetchImpl })

    // Move the clock past the new expiry and refresh again.
    const later = new Date(NOW.getTime() + 4_000_000)
    const result = await getValidAccessToken(USER, { now: later, fetchImpl: endpoint.fetchImpl })

    expect(result.accessToken).toBe('access-2')
    expect(endpoint.calls()).toBe(2)
  })
})

describe('permanent failure', () => {
  it('asks the user to reconnect when the grant is dead', async () => {
    await seedAccount()
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: 'invalid_grant', error_description: 'AADSTS700082: refresh token expired' },
        400,
      ),
    ) as unknown as typeof fetch

    const result = await getValidAccessToken(USER, { now: NOW, fetchImpl })

    expect(result.state).toBe('needs_reconnect')
    expect(result.message).toMatch(/reconnect/i)
  })

  it('DESTROYS the dead credentials rather than keeping them', async () => {
    await seedAccount()
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'invalid_grant' }, 400),
    ) as unknown as typeof fetch

    await getValidAccessToken(USER, { now: NOW, fetchImpl })

    const row = await readAccount()
    expect(row?.accessTokenEncrypted).toBeNull()
    expect(row?.refreshTokenEncrypted).toBeNull()
    expect(row?.lastSyncError).toMatch(/reconnect/i)
    // Still listed, so the user can see it needs attention.
    expect(row?.revokedAt).toBeNull()
  })

  it('treats a missing refresh token as needing reconnection', async () => {
    await seedAccount({ refreshTokenEncrypted: null })
    const endpoint = rotatingEndpoint()

    const result = await getValidAccessToken(USER, { now: NOW, fetchImpl: endpoint.fetchImpl })

    expect(result.state).toBe('needs_reconnect')
    expect(endpoint.calls()).toBe(0)
  })

  it('reports undecryptable credentials honestly', async () => {
    await seedAccount({ tokenExpiresAt: new Date(NOW.getTime() + 3_600_000) })
    // Simulate a rotated encryption key.
    process.env.MOMENTUM_ENCRYPTION_KEY = Buffer.alloc(32, 99).toString('base64')

    const result = await getValidAccessToken(USER, { now: NOW })

    expect(result.state).toBe('needs_reconnect')
    expect(result.message).toMatch(/encryption key/i)
  })
})

describe('transient failure', () => {
  it('does NOT disconnect over a network blip', async () => {
    await seedAccount()
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch

    const result = await getValidAccessToken(USER, { now: NOW, fetchImpl })

    expect(result.state).toBe('temporarily_unavailable')

    const row = await readAccount()
    // Credentials survive, so a later retry can succeed.
    expect(row?.accessTokenEncrypted).not.toBeNull()
    expect(row?.refreshTokenEncrypted).not.toBeNull()
  })

  it('treats a 5xx as transient', async () => {
    await seedAccount()
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'temporarily_unavailable' }, 503),
    ) as unknown as typeof fetch

    const result = await getValidAccessToken(USER, { now: NOW, fetchImpl })
    expect(result.state).toBe('temporarily_unavailable')
    expect((await readAccount())?.refreshTokenEncrypted).not.toBeNull()
  })

  it('recovers on a later attempt', async () => {
    await seedAccount()
    const failing = vi.fn(async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch

    await getValidAccessToken(USER, { now: NOW, fetchImpl: failing })
    resetInFlightRefreshes()

    const endpoint = rotatingEndpoint()
    const result = await getValidAccessToken(USER, { now: NOW, fetchImpl: endpoint.fetchImpl })

    expect(result.state).toBe('refreshed')
    expect(result.accessToken).toBe('access-1')
  })

  it('reports missing configuration without destroying credentials', async () => {
    await seedAccount()
    delete process.env.MS_GRAPH_CLIENT_ID

    const result = await getValidAccessToken(USER, { now: NOW })

    expect(result.state).toBe('temporarily_unavailable')
    expect((await readAccount())?.refreshTokenEncrypted).not.toBeNull()
  })
})

describe('no connected account', () => {
  it('reports not_connected rather than failing', async () => {
    const database = await getDb()
    await database.delete(connectedAccounts).where(eq(connectedAccounts.userId, USER))

    expect((await getValidAccessToken(USER, { now: NOW })).state).toBe('not_connected')
  })

  it('ignores a revoked account', async () => {
    await seedAccount({ revokedAt: NOW })
    expect((await getValidAccessToken(USER, { now: NOW })).state).toBe('not_connected')
  })
})

describe('the email provider resolver', () => {
  it('falls back to demo and explains why when the grant is dead', async () => {
    await seedAccount()
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'invalid_grant' }, 400),
    ) as unknown as typeof fetch

    // Drive the failure through the token layer first.
    await getValidAccessToken(USER, { now: NOW, fetchImpl })
    resetInFlightRefreshes()

    const { getEmailProvider } = await import('@/server/email/provider')
    const resolved = await getEmailProvider(USER)

    expect(resolved.isDemo).toBe(true)
    expect(resolved.needsReconnect).toBe(true)
    expect(resolved.problem).toMatch(/reconnect/i)
  })
})
