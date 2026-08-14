import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Encryption for integration tokens at rest.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to decrypt rather
 * than silently yielding garbage. The key lives in the environment and never in
 * the database — an attacker with a copy of momentum.db alone gets nothing.
 *
 * Format: base64(iv) . base64(authTag) . base64(ciphertext)
 */

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super(
      'MOMENTUM_ENCRYPTION_KEY is not set. Generate one with:\n' +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    )
    this.name = 'EncryptionKeyMissingError'
  }
}

function getKey(): Buffer {
  const raw = process.env.MOMENTUM_ENCRYPTION_KEY?.trim()
  if (!raw) throw new EncryptionKeyMissingError()

  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(
      `MOMENTUM_ENCRYPTION_KEY must decode to exactly 32 bytes; got ${key.length}. Generate a new one.`,
    )
  }
  return key
}

export function encryptSecret(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
    '.',
  )
}

export function decryptSecret(encoded: string): string {
  const key = getKey()
  const parts = encoded.split('.')
  if (parts.length !== 3) {
    throw new Error('Stored secret is malformed and cannot be decrypted.')
  }

  const [ivB64, tagB64, dataB64] = parts as [string, string, string]
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

/**
 * Redacts a secret for logging. Never log the value itself — this exists so
 * that "which token failed?" is answerable without writing one to a log file.
 */
export function fingerprint(secret: string): string {
  if (secret.length <= 8) return '••••'
  return `${secret.slice(0, 3)}…${secret.slice(-2)} (len ${secret.length})`
}
