/**
 * Rate limiting for sensitive and expensive operations.
 *
 * In-memory and per-process, which is the right scope for a local single-user
 * app: there is one process and one user. A deployed multi-user version would
 * swap the store for Redis or a database table — the interface would not
 * change.
 *
 * What it actually protects against here is not a malicious third party but
 * runaway cost and accidental loops: a stuck retry, a double-submitted form,
 * or a bug that calls the model in a render.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterMs: number
}

export interface RateLimitOptions {
  /** Maximum operations allowed inside the window. */
  limit: number
  windowMs: number
}

/** Sensible defaults per operation class. */
export const RATE_LIMITS = {
  /** Model calls cost money; a stuck loop should stop quickly. */
  modelCall: { limit: 20, windowMs: 60_000 },
  /** Capture is cheap but a double-submit should not create two items. */
  capture: { limit: 60, windowMs: 60_000 },
  /** Sending mail is irreversible. Deliberately tight. */
  send: { limit: 5, windowMs: 60_000 },
  /** Full data export reads everything; no reason to do it repeatedly. */
  export: { limit: 3, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitOptions>

export function checkRateLimit(
  key: string,
  options: RateLimitOptions,
  now: number = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key)

  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs })
    return { allowed: true, remaining: options.limit - 1, retryAfterMs: 0 }
  }

  if (existing.count >= options.limit) {
    return { allowed: false, remaining: 0, retryAfterMs: existing.resetAt - now }
  }

  existing.count += 1
  return { allowed: true, remaining: options.limit - existing.count, retryAfterMs: 0 }
}

/** Test seam. */
export function resetRateLimits(): void {
  buckets.clear()
}
