import { z } from 'zod'

/**
 * Environment validation.
 *
 * Configuration is checked where it is used rather than all at once at boot,
 * because this app is designed to run with almost nothing configured. A
 * missing `ANTHROPIC_API_KEY` is a normal state (demo mode), not a fatal error.
 * What must never happen is a half-configured integration failing deep inside a
 * request with an opaque message — so each feature validates its own block and
 * reports precisely what is missing and how to fix it.
 */

const base64Key32 = z.string().refine((value) => {
  try {
    return Buffer.from(value, 'base64').length === 32
  } catch {
    return false
  }
}, 'must be 32 bytes, base64-encoded')

const microsoftSchema = z.object({
  MS_GRAPH_CLIENT_ID: z.string().min(1),
  MS_GRAPH_TENANT_ID: z.string().min(1),
  MS_GRAPH_CLIENT_SECRET: z.string().min(1),
  MS_GRAPH_REDIRECT_URI: z.string().url(),
  MOMENTUM_ENCRYPTION_KEY: base64Key32,
})

export type MicrosoftEnv = z.infer<typeof microsoftSchema>

/**
 * A bag of environment values.
 *
 * Deliberately looser than `NodeJS.ProcessEnv`, which requires `NODE_ENV` and
 * so cannot be satisfied by a small fixture — tests need to pass exactly the
 * few keys under test and nothing else.
 */
export type EnvSource = Record<string, string | undefined>

export interface EnvCheck<T> {
  ok: boolean
  value?: T
  /** Human-readable, actionable, and safe to render in the UI. */
  problems: string[]
}

const FIX_HINTS: Record<string, string> = {
  MS_GRAPH_CLIENT_ID: 'Application (client) ID from your Entra app registration.',
  MS_GRAPH_TENANT_ID: 'Directory (tenant) ID, or "common" for any account.',
  MS_GRAPH_CLIENT_SECRET: 'A client secret value from Certificates & secrets.',
  MS_GRAPH_REDIRECT_URI:
    'Must match the redirect URI registered in Entra exactly, e.g. http://localhost:3000/api/integrations/microsoft/callback',
  MOMENTUM_ENCRYPTION_KEY:
    "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
}

/**
 * Validates the Microsoft integration block.
 *
 * Returns problems rather than throwing: the Settings page renders them as a
 * checklist so a misconfiguration is visible before the user is bounced to a
 * Microsoft error page.
 */
export function checkMicrosoftEnv(source: EnvSource = process.env): EnvCheck<MicrosoftEnv> {
  const result = microsoftSchema.safeParse(source)

  if (result.success) {
    return { ok: true, value: result.data, problems: [] }
  }

  const problems = result.error.issues.map((issue) => {
    const key = String(issue.path[0] ?? 'configuration')
    const hint = FIX_HINTS[key]
    const reason = issue.code === 'invalid_type' ? 'is not set' : issue.message
    return hint ? `${key} ${reason}. ${hint}` : `${key} ${reason}.`
  })

  return { ok: false, problems }
}

/** True when every value needed to start an OAuth flow is present and valid. */
export function isMicrosoftConfigured(source: EnvSource = process.env): boolean {
  return checkMicrosoftEnv(source).ok
}

/**
 * Validates that token encryption is usable on its own.
 *
 * Checked separately because it gates *storing* a token, which matters even if
 * the rest of the OAuth config is fine — refusing to complete a connection is
 * far better than writing a plaintext token to disk.
 */
export function checkEncryptionKey(source: EnvSource = process.env): EnvCheck<string> {
  const result = base64Key32.safeParse(source.MOMENTUM_ENCRYPTION_KEY ?? '')
  if (result.success) return { ok: true, value: result.data, problems: [] }

  return {
    ok: false,
    problems: [
      `MOMENTUM_ENCRYPTION_KEY ${result.error.issues[0]?.message ?? 'is invalid'}. ${FIX_HINTS.MOMENTUM_ENCRYPTION_KEY}`,
    ],
  }
}
