/**
 * Validates local configuration using the application's own checks.
 *
 * Reports whether each integration is usable and, when not, exactly what is
 * missing — without ever printing a secret's value. Run with:
 *
 *   npx tsx scripts/check-config.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkEncryptionKey, checkMicrosoftEnv } from '../src/server/env'

/**
 * Minimal .env.local reader.
 *
 * Deliberately not a dependency: this script exists to diagnose configuration,
 * so it should have as little machinery of its own as possible. Existing
 * process env wins, matching how Next resolves precedence.
 */
function loadEnvLocal(): void {
  const path = resolve(process.cwd(), '.env.local')
  if (!existsSync(path)) {
    console.log('No .env.local found.\n')
    return
  }

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match?.[1]) continue
    const value = (match[2] ?? '').trim().replace(/^["']|["']$/g, '')
    if (process.env[match[1]] === undefined) process.env[match[1]] = value
  }
}

loadEnvLocal()

function describe(name: string): string {
  const raw = process.env[name]
  if (raw === undefined) return 'absent'
  if (raw.trim() === '') return 'empty'
  return `set (${raw.trim().length} chars)`
}

console.log('Presence — values are never printed\n')
for (const name of [
  'MS_GRAPH_CLIENT_ID',
  'MS_GRAPH_TENANT_ID',
  'MS_GRAPH_CLIENT_SECRET',
  'MS_GRAPH_REDIRECT_URI',
  'MOMENTUM_ENCRYPTION_KEY',
  'ANTHROPIC_API_KEY',
]) {
  console.log(`  ${name.padEnd(26)} ${describe(name)}`)
}

const encryption = checkEncryptionKey()
console.log(`\nEncryption key: ${encryption.ok ? 'VALID' : 'INVALID'}`)
for (const problem of encryption.problems) console.log(`  - ${problem}`)

const microsoft = checkMicrosoftEnv()
console.log(`\nMicrosoft integration: ${microsoft.ok ? 'READY TO CONNECT' : 'NOT READY'}`)
for (const problem of microsoft.problems) console.log(`  - ${problem}`)

if (microsoft.ok && microsoft.value) {
  // Echo back only the non-secret values, so a typo in the redirect URI or
  // tenant is visible before Microsoft rejects it.
  console.log(`\n  tenant:       ${microsoft.value.MS_GRAPH_TENANT_ID}`)
  console.log(`  redirect URI: ${microsoft.value.MS_GRAPH_REDIRECT_URI}`)

  const uri = new URL(microsoft.value.MS_GRAPH_REDIRECT_URI)
  const expectedPath = '/api/integrations/microsoft/callback'
  if (uri.pathname !== expectedPath) {
    console.log(`  WARNING: path should be ${expectedPath}`)
  }
  if (uri.port && uri.port !== '3000') {
    console.log(`  WARNING: port ${uri.port} — the server must listen on that port`)
  }
}

process.exit(microsoft.ok && encryption.ok ? 0 : 1)
