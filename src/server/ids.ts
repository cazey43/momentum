import { randomBytes } from 'node:crypto'

/**
 * Collision-resistant identifiers.
 *
 * Timestamp-only ids (`prefix_${Date.now()}`) look unique but are not: two
 * writes in the same millisecond produce the same value and the second fails
 * on the primary key. That is easy to miss in development and shows up as a
 * hard failure under any concurrency — including a user double-clicking.
 *
 * Sortable prefix (base36 time) plus random entropy: still roughly ordered by
 * creation for readability, but no longer dependent on clock resolution.
 */
export function newId(prefix: string, now: Date = new Date()): string {
  return `${prefix}_${now.getTime().toString(36)}_${randomBytes(6).toString('hex')}`
}
