import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encouragements, items, users } from './schema'

/**
 * These are integration tests against a real (in-memory) SQLite database, not
 * mocks. The point is to prove that the database itself refuses to store a
 * dishonest row — a mocked repository would prove nothing.
 */

let client: ReturnType<typeof createClient>
let db: ReturnType<typeof drizzle>

const USER_ID = 'user_test'

beforeAll(async () => {
  client = createClient({ url: ':memory:' })
  db = drizzle(client)
  await migrate(db, { migrationsFolder: './drizzle' })
  await client.execute('PRAGMA foreign_keys = ON')

  await db.insert(users).values({ id: USER_ID, displayName: 'Test User' })
})

afterAll(() => {
  client.close()
})

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    id: `item_${Math.round(performance.now() * 1000)}_${Object.keys(overrides).length}`,
    userId: USER_ID,
    kind: 'task' as const,
    title: 'Send the contract to Dana',
    dedupeKey: `key_${performance.now()}`,
    ...overrides,
  }
}

describe('items: the honesty constraint', () => {
  it('accepts a user-created item with no confidence, because the user is the source', async () => {
    await expect(
      db.insert(items).values(baseItem({ origin: 'user', id: 'item_user_ok', dedupeKey: 'k1' })),
    ).resolves.toBeDefined()
  })

  it('REJECTS an AI-created item that has no confidence', async () => {
    await expect(
      db.insert(items).values(
        baseItem({
          origin: 'ai',
          confidence: null,
          reason: 'Detected a commitment in an email.',
          id: 'item_ai_noconf',
          dedupeKey: 'k2',
        }),
      ),
    ).rejects.toThrow()
  })

  it('REJECTS an AI-created item that has no stated reason', async () => {
    await expect(
      db.insert(items).values(
        baseItem({
          origin: 'ai',
          confidence: 'medium',
          reason: null,
          id: 'item_ai_noreason',
          dedupeKey: 'k3',
        }),
      ),
    ).rejects.toThrow()
  })

  it('accepts an AI-created item carrying both confidence and a reason', async () => {
    await expect(
      db.insert(items).values(
        baseItem({
          origin: 'ai',
          confidence: 'medium',
          reason: 'You wrote "I\'ll send this over Friday" on Tue 5 Aug.',
          id: 'item_ai_ok',
          dedupeKey: 'k4',
        }),
      ),
    ).resolves.toBeDefined()
  })

  it('rejects an unknown item kind even when the ORM is bypassed entirely', async () => {
    // Raw SQL on purpose: this proves the constraint lives in the database,
    // not in Drizzle's type layer. A future caller using raw SQL, a migration
    // script, or a sqlite3 shell is bound by the same rule.
    await expect(
      client.execute({
        sql: 'insert into items (id, user_id, kind, title, dedupe_key) values (?, ?, ?, ?, ?)',
        args: ['item_bad_kind', USER_ID, 'nonsense', 'Not a real kind', 'k5'],
      }),
    ).rejects.toThrow()
  })

  it('rejects an AI item inserted via raw SQL without confidence', async () => {
    await expect(
      client.execute({
        sql: 'insert into items (id, user_id, kind, title, dedupe_key, origin) values (?, ?, ?, ?, ?, ?)',
        args: ['item_raw_ai', USER_ID, 'task', 'Snuck past the ORM', 'k6', 'ai'],
      }),
    ).rejects.toThrow()
  })

  it('enforces one item per dedupe key, so the same commitment is never doubled', async () => {
    await db.insert(items).values(baseItem({ id: 'item_dupe_a', dedupeKey: 'shared-key' }))
    await expect(
      db.insert(items).values(baseItem({ id: 'item_dupe_b', dedupeKey: 'shared-key' })),
    ).rejects.toThrow()
  })
})

describe('encouragements: no invented attributions', () => {
  it('rejects original encouragement that carries an attribution', async () => {
    await expect(
      db.insert(encouragements).values({
        id: 'enc_bad',
        userId: USER_ID,
        body: 'You have made real progress this week.',
        kind: 'original',
        attribution: 'Marcus Aurelius',
        localDate: '2026-08-13',
      }),
    ).rejects.toThrow()
  })

  it('allows original encouragement with no attribution', async () => {
    await expect(
      db.insert(encouragements).values({
        id: 'enc_ok',
        userId: USER_ID,
        body: 'Only one thing here is time-sensitive. Start there.',
        kind: 'original',
        attribution: null,
        localDate: '2026-08-14',
      }),
    ).resolves.toBeDefined()
  })

  it('allows at most one encouragement per day', async () => {
    await expect(
      db.insert(encouragements).values({
        id: 'enc_second',
        userId: USER_ID,
        body: 'A second one on the same day.',
        kind: 'original',
        localDate: '2026-08-14',
      }),
    ).rejects.toThrow()
  })
})
