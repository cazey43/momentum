import { migrate } from 'drizzle-orm/libsql/migrator'
import { db, sqliteClient } from './client'

/**
 * Applies pending migrations, then turns on foreign key enforcement.
 *
 * SQLite defaults `foreign_keys` to OFF per connection, so the ON DELETE
 * CASCADE rules in the schema are inert unless every connection enables it.
 * The app connection does this too — see the pragma call below and in client
 * usage.
 */
async function main() {
  await sqliteClient.execute('PRAGMA foreign_keys = ON')

  console.log('Applying migrations…')
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('Migrations applied.')

  const tables = await sqliteClient.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
  )
  console.log(`${tables.rows.length} tables present:`)
  for (const row of tables.rows) {
    console.log(`  - ${String(row.name)}`)
  }
}

main()
  .then(() => {
    sqliteClient.close()
    process.exit(0)
  })
  .catch((error) => {
    console.error('Migration failed:', error)
    sqliteClient.close()
    process.exit(1)
  })
