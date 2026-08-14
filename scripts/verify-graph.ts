/**
 * Verifies the Microsoft Graph adapter against the connected mailbox.
 *
 * PRIVACY: this reads real mail, so it reports only *structure* — counts,
 * field presence, types, lengths. No subject, body, address, or name is ever
 * printed. The point is to confirm the adapter's assumptions about Graph's
 * response shapes, which needs no content at all.
 *
 *   npx tsx scripts/verify-graph.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@libsql/client'

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match?.[1]) continue
    const value = (match[2] ?? '').trim().replace(/^["']|["']$/g, '')
    if (process.env[match[1]] === undefined) process.env[match[1]] = value
  }
}

loadEnvLocal()

const { decryptSecret } = await import('../src/server/crypto')
const { GraphEmailProvider } = await import('../src/adapters/email/graph')

const client = createClient({ url: process.env.DATABASE_URL ?? 'file:./momentum.db' })

// --- 1. Stored account state ------------------------------------------------
const accounts = await client.execute(
  `select id, provider, account_label, granted_scopes, token_expires_at,
          access_token_encrypted, refresh_token_encrypted, revoked_at, last_sync_error
   from connected_accounts where revoked_at is null`,
)

console.log('=== 1. Stored account ===')
console.log(`rows: ${accounts.rows.length}`)

const account = accounts.rows[0]
if (!account) {
  console.log('No active connected account. Nothing to verify.')
  client.close()
  process.exitCode = 1
} else {
  const label = String(account.account_label ?? '')
  const scopes = JSON.parse(String(account.granted_scopes ?? '[]')) as string[]
  const expiresAt = account.token_expires_at ? new Date(Number(account.token_expires_at)) : null

  console.log(`provider:              ${account.provider}`)
  console.log(`label domain:          @${label.split('@')[1] ?? '(none)'}`) // domain only
  console.log(`granted scopes:        ${scopes.join(' ') || '(none)'}`)
  console.log(`access token stored:   ${account.access_token_encrypted !== null}`)
  console.log(`refresh token stored:  ${account.refresh_token_encrypted !== null}`)
  console.log(`expires:               ${expiresAt?.toISOString() ?? 'null'}`)
  console.log(
    `minutes until expiry:  ${expiresAt ? Math.round((expiresAt.getTime() - Date.now()) / 60000) : 'n/a'}`,
  )
  console.log(`last error:            ${account.last_sync_error ?? 'none'}`)

  const forbidden = scopes.filter((s) => /mail\.send|mail\.readwrite|\.write|full_access/i.test(s))
  console.log(
    `write/send scopes:     ${forbidden.length === 0 ? 'NONE (correct)' : forbidden.join(' ')}`,
  )
  console.log(`offline_access:        ${scopes.some((s) => /offline_access/i.test(s))}`)

  // --- 2. Live adapter calls -------------------------------------------------
  const accessToken = decryptSecret(String(account.access_token_encrypted))
  const provider = new GraphEmailProvider({ accessToken, selfAddress: label })

  console.log('\n=== 2. GET /me (User.Read) ===')
  const connected = await provider.isConnected()
  console.log(`isConnected(): ${connected}`)

  console.log('\n=== 3. listThreads() — $filter + $orderby + $select ===')
  let threads: Awaited<ReturnType<typeof provider.listThreads>> = []
  try {
    threads = await provider.listThreads({ limit: 50 })
    console.log(`threads returned:      ${threads.length}`)
  } catch (error) {
    console.log(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (threads.length > 0) {
    const withSubject = threads.filter((t) => t.subject !== null && t.subject !== '').length
    const withParticipants = threads.filter((t) => t.participants.length > 0).length
    const withDate = threads.filter((t) => t.lastMessageAt instanceof Date).length
    const validDate = threads.filter(
      (t) => t.lastMessageAt && !Number.isNaN(t.lastMessageAt.getTime()),
    ).length
    const fromMe = threads.filter((t) => t.lastMessageFromMe).length
    const unread = threads.filter((t) => t.unread).length

    console.log(`with a subject:        ${withSubject}/${threads.length}`)
    console.log(`with participants:     ${withParticipants}/${threads.length}`)
    console.log(`lastMessageAt is Date: ${withDate}/${threads.length}`)
    console.log(`  ...and parses:       ${validDate}/${threads.length}`)
    console.log(`unread:                ${unread}`)
    console.log(`lastMessageFromMe:     ${fromMe}  <-- 0 here means UPN != From address`)

    const byCategory = threads.reduce<Record<string, number>>((acc, t) => {
      acc[t.category] = (acc[t.category] ?? 0) + 1
      return acc
    }, {})
    console.log(`categories:            ${JSON.stringify(byCategory)}`)

    const ids = threads.map((t) => t.externalThreadId)
    console.log(`conversationIds unique:${new Set(ids).size}/${ids.length}`)
    console.log(
      `avg participants:      ${(threads.reduce((n, t) => n + t.participants.length, 0) / threads.length).toFixed(1)}`,
    )

    // --- 4. Per-thread read ---------------------------------------------------
    console.log('\n=== 4. listMessagesInThread() — conversationId filter + body ===')
    const target = threads.find((t) => t.participants.length > 1) ?? threads[0]
    if (target) {
      try {
        const messages = await provider.listMessagesInThread(target.externalThreadId)
        console.log(`messages in thread:    ${messages.length}`)

        const withBody = messages.filter((m) => m.bodyText.trim().length > 0).length
        const withHtmlLeftovers = messages.filter((m) => /<[a-z][^>]*>/i.test(m.bodyText)).length
        const withUrl = messages.filter((m) => m.webUrl).length
        const senders = messages.filter((m) => m.from.address).length
        const mine = messages.filter((m) => m.fromMe).length
        const avgLen = messages.length
          ? Math.round(messages.reduce((n, m) => n + m.bodyText.length, 0) / messages.length)
          : 0

        console.log(`with non-empty body:   ${withBody}/${messages.length}`)
        console.log(`avg body chars:        ${avgLen}`)
        console.log(`HTML tags left in text:${withHtmlLeftovers}  <-- should be 0`)
        console.log(`with webUrl:           ${withUrl}/${messages.length}`)
        console.log(`with a from address:   ${senders}/${messages.length}`)
        console.log(`detected as fromMe:    ${mine}/${messages.length}`)
        console.log(
          `all share conversationId: ${messages.every((m) => m.externalThreadId === target.externalThreadId)}`,
        )
      } catch (error) {
        console.log(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // --- 5. Incremental sync window ------------------------------------------
    console.log('\n=== 5. listThreads({ since }) — incremental window ===')
    try {
      const since = new Date(Date.now() - 30 * 86_400_000)
      const recent = await provider.listThreads({ since, limit: 50 })
      console.log(`threads in last 30d:   ${recent.length}`)
      console.log(`(fewer than ${threads.length} total means $filter is applied)`)
    } catch (error) {
      console.log(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  client.close()
}
