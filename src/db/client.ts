import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'

/**
 * Local SQLite connection.
 *
 * libSQL is used rather than better-sqlite3 so the project installs from
 * prebuilt binaries on Windows without a native toolchain. The Drizzle schema
 * is dialect-portable: moving to Postgres later means swapping this file and
 * the column helpers, not the domain layer.
 */
const url = process.env.DATABASE_URL ?? 'file:./momentum.db'

export const sqliteClient = createClient({ url })

export const db = drizzle(sqliteClient, { schema })

export type Database = typeof db

/**
 * SQLite disables foreign key enforcement by default, per connection. Without
 * this pragma every ON DELETE CASCADE in the schema is decorative. Awaited
 * once and memoized so callers cannot forget it.
 */
let pragmasApplied: Promise<void> | null = null

export async function getDb(): Promise<Database> {
  if (!pragmasApplied) {
    pragmasApplied = sqliteClient.execute('PRAGMA foreign_keys = ON').then(() => undefined)
  }
  await pragmasApplied
  return db
}
