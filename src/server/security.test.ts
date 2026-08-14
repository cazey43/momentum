import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, fingerprint } from './crypto'
import { newId } from './ids'
import { checkRateLimit, RATE_LIMITS, resetRateLimits } from './ratelimit'

const KEY = Buffer.alloc(32, 7).toString('base64')

describe('token encryption', () => {
  const original = process.env.MOMENTUM_ENCRYPTION_KEY

  beforeEach(() => {
    process.env.MOMENTUM_ENCRYPTION_KEY = KEY
  })

  afterEach(() => {
    if (original === undefined) delete process.env.MOMENTUM_ENCRYPTION_KEY
    else process.env.MOMENTUM_ENCRYPTION_KEY = original
  })

  it('round-trips a token', () => {
    const token = 'ya29.a0AfH6SM-not-a-real-token'
    expect(decryptSecret(encryptSecret(token))).toBe(token)
  })

  it('never stores the plaintext in the ciphertext', () => {
    const token = 'super-secret-refresh-token'
    expect(encryptSecret(token)).not.toContain(token)
  })

  it('produces different ciphertext each time, so equal tokens are not linkable', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it('REFUSES to decrypt tampered ciphertext', () => {
    // GCM is authenticated: a flipped byte must fail loudly rather than
    // silently yielding corrupted output.
    const encoded = encryptSecret('sensitive')
    const [iv, tag, data] = encoded.split('.') as [string, string, string]
    const tamperedData = Buffer.from(data, 'base64')
    tamperedData[0] = (tamperedData[0] ?? 0) ^ 0xff

    expect(() => decryptSecret([iv, tag, tamperedData.toString('base64')].join('.'))).toThrow()
  })

  it('REFUSES to decrypt with a forged auth tag', () => {
    const encoded = encryptSecret('sensitive')
    const [iv, , data] = encoded.split('.') as [string, string, string]
    const forgedTag = Buffer.alloc(16, 1).toString('base64')

    expect(() => decryptSecret([iv, forgedTag, data].join('.'))).toThrow()
  })

  it('REFUSES to decrypt with the wrong key', () => {
    const encoded = encryptSecret('sensitive')
    process.env.MOMENTUM_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
    expect(() => decryptSecret(encoded)).toThrow()
  })

  it('rejects a malformed payload', () => {
    expect(() => decryptSecret('not-a-valid-payload')).toThrow(/malformed/i)
  })

  it('demands a key rather than falling back to a default', () => {
    delete process.env.MOMENTUM_ENCRYPTION_KEY
    expect(() => encryptSecret('x')).toThrow(/MOMENTUM_ENCRYPTION_KEY/)
  })

  it('rejects a key of the wrong length instead of padding it', () => {
    process.env.MOMENTUM_ENCRYPTION_KEY = Buffer.alloc(16, 3).toString('base64')
    expect(() => encryptSecret('x')).toThrow(/32 bytes/)
  })
})

describe('fingerprint', () => {
  it('never reveals the middle of a secret', () => {
    const secret = 'abcdefghijklmnop'
    const printed = fingerprint(secret)
    expect(printed).not.toContain('defghijklmn')
    expect(printed).toContain('abc')
  })

  it('fully masks a short secret', () => {
    expect(fingerprint('abc')).toBe('••••')
  })
})

describe('identifier generation', () => {
  it('does not collide within a single millisecond', () => {
    // The bug this replaced: `prefix_${Date.now()}` produced duplicate primary
    // keys whenever two writes landed in the same millisecond.
    const fixed = new Date('2026-08-13T15:00:00Z')
    const ids = new Set(Array.from({ length: 5000 }, () => newId('audit', fixed)))
    expect(ids.size).toBe(5000)
  })

  it('keeps the prefix and stays roughly time-ordered', () => {
    const earlier = newId('audit', new Date('2026-08-13T15:00:00Z'))
    const later = newId('audit', new Date('2026-08-13T16:00:00Z'))
    expect(earlier.startsWith('audit_')).toBe(true)
    expect(earlier < later).toBe(true)
  })
})

describe('rate limiting', () => {
  beforeEach(() => resetRateLimits())

  it('allows traffic under the limit', () => {
    const now = 1_000_000
    for (let i = 0; i < RATE_LIMITS.send.limit; i += 1) {
      expect(checkRateLimit('user:send', RATE_LIMITS.send, now).allowed).toBe(true)
    }
  })

  it('blocks once the limit is reached', () => {
    const now = 1_000_000
    for (let i = 0; i < RATE_LIMITS.send.limit; i += 1) {
      checkRateLimit('user:send', RATE_LIMITS.send, now)
    }
    const blocked = checkRateLimit('user:send', RATE_LIMITS.send, now)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it('recovers after the window passes', () => {
    const now = 1_000_000
    for (let i = 0; i < RATE_LIMITS.send.limit; i += 1) {
      checkRateLimit('user:send', RATE_LIMITS.send, now)
    }
    const later = now + RATE_LIMITS.send.windowMs + 1
    expect(checkRateLimit('user:send', RATE_LIMITS.send, later).allowed).toBe(true)
  })

  it('keeps separate buckets per key', () => {
    const now = 1_000_000
    for (let i = 0; i < RATE_LIMITS.send.limit; i += 1) {
      checkRateLimit('a:send', RATE_LIMITS.send, now)
    }
    expect(checkRateLimit('b:send', RATE_LIMITS.send, now).allowed).toBe(true)
  })

  it('keeps sending on a tighter leash than reading', () => {
    // Irreversible actions should not share a budget with cheap ones.
    expect(RATE_LIMITS.send.limit).toBeLessThan(RATE_LIMITS.capture.limit)
  })
})
