/**
 * Prints recent background-job activity from the local database.
 *
 * Useful for confirming the scheduler is actually doing work in a running
 * process, which unit tests with fake timers cannot demonstrate:
 *
 *   MOMENTUM_ENABLE_SCHEDULER=true npm run start
 *   node scripts/inspect-jobs.mjs
 */
import { createClient } from '@libsql/client'

const url = process.env.DATABASE_URL ?? 'file:./momentum.db'
const client = createClient({ url })

const runs = await client.execute(
  'select job_name, status, error, started_at, finished_at from job_runs order by started_at desc limit 20',
)
console.log(`job_runs rows: ${runs.rows.length}`)
for (const r of runs.rows) {
  const ms = r.finished_at && r.started_at ? Number(r.finished_at) - Number(r.started_at) : null
  console.log(
    `   ${r.job_name} => ${r.status}${ms === null ? '' : ` (${ms}ms)`}${r.error ? ` [${r.error}]` : ''}`,
  )
}

const cursors = await client.execute(
  'select resource, last_success_at, last_error from sync_cursors',
)
console.log(`sync_cursors rows: ${cursors.rows.length}`)
for (const c of cursors.rows) {
  const at = c.last_success_at ? new Date(Number(c.last_success_at)).toISOString() : 'never'
  console.log(`   ${c.resource} lastSuccess=${at} err=${c.last_error ?? 'none'}`)
}

const threads = await client.execute(
  'select is_demo, count(*) as n from email_threads group by is_demo',
)
for (const t of threads.rows) {
  console.log(`   email_threads is_demo=${t.is_demo}: ${t.n}`)
}

client.close()
