/**
 * Non-interactive credential probe for the Entra app registration.
 *
 * Sends an authorization-code token request with a deliberately invalid code.
 * Microsoft validates the *client credentials* before it validates the code, so
 * the error it returns distinguishes a bad client secret from a bad tenant,
 * a wrong client id, or a correctly-configured app.
 *
 * Connects nothing, stores nothing, and touches no mailbox. Run with:
 *
 *   npx tsx scripts/probe-entra.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

const clientId = process.env.MS_GRAPH_CLIENT_ID ?? ''
const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET ?? ''
const tenant = process.env.MS_GRAPH_TENANT_ID ?? 'common'
const redirectUri = process.env.MS_GRAPH_REDIRECT_URI ?? ''

if (!clientId || !clientSecret || !redirectUri) {
  console.log('Configuration incomplete; nothing to probe.')
  process.exit(1)
}

const body = new URLSearchParams({
  client_id: clientId,
  client_secret: clientSecret,
  grant_type: 'authorization_code',
  // Intentionally invalid. We only care which error comes back.
  code: 'probe-invalid-code',
  redirect_uri: redirectUri,
  scope: 'offline_access User.Read Mail.Read MailboxSettings.Read',
})

const response = await fetch(
  `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  },
)

const payload = (await response.json()) as { error?: string; error_description?: string }
const description = payload.error_description ?? ''
const code = /AADSTS\d+/.exec(description)?.[0] ?? '(no AADSTS code)'

console.log(`HTTP ${response.status}   error=${payload.error ?? 'none'}   ${code}\n`)

/** Maps the observed AADSTS code to a specific, actionable conclusion. */
const verdicts: { match: RegExp; secretOk: boolean; verdict: string; fix: string }[] = [
  {
    match: /AADSTS7000215/,
    secretOk: false,
    verdict: 'The CLIENT SECRET is wrong.',
    fix: 'Copy the Value column (not Secret ID) from Certificates & secrets. If the Value is masked, create a new secret and copy it immediately.',
  },
  {
    match: /AADSTS7000222/,
    secretOk: false,
    verdict: 'The client secret has EXPIRED.',
    fix: 'Create a new client secret and copy its Value.',
  },
  {
    match: /AADSTS700016|AADSTS90002/,
    secretOk: false,
    verdict: 'The application was not found in this tenant.',
    fix: 'Check MS_GRAPH_CLIENT_ID, and that MS_GRAPH_TENANT_ID matches the app’s Supported account types.',
  },
  {
    match: /AADSTS50194|AADSTS700027/,
    secretOk: false,
    verdict: 'The app is single-tenant but the request used /common.',
    fix: 'Set MS_GRAPH_TENANT_ID to your Directory (tenant) ID.',
  },
  {
    match: /AADSTS50011/,
    secretOk: true,
    verdict: 'Credentials accepted, but the REDIRECT URI does not match the registration.',
    fix: 'Make the Entra redirect URI byte-identical to MS_GRAPH_REDIRECT_URI.',
  },
  {
    match: /AADSTS70008|AADSTS9002313|AADSTS54005|AADSTS70000/,
    secretOk: true,
    verdict:
      'CREDENTIALS ARE GOOD — rejected only because the probe code was fake, which is exactly what we wanted.',
    fix: 'Nothing. Ready to connect.',
  },
]

const hit = verdicts.find((v) => v.match.test(description))

if (hit) {
  console.log(`${hit.secretOk ? '✓' : '✗'} ${hit.verdict}`)
  console.log(`  Fix: ${hit.fix}`)
} else {
  console.log('Unrecognised response. Full description follows (contains no secret):')
  console.log(`  ${description || JSON.stringify(payload)}`)
}

// Set the code rather than calling process.exit(), which can abort a still-
// closing libuv handle on Windows and print a spurious assertion failure.
process.exitCode = hit?.secretOk ? 0 : 1
