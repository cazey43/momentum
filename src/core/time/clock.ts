import { DateTime } from 'luxon'

/**
 * The only sanctioned way to read the current time.
 *
 * Everything time-dependent in Momentum — quiet hours, snooze expiry, nudge
 * budgets, overdue detection, reminder escalation — is a pure function of an
 * injected Clock. That is what makes those rules testable without mocking a
 * scheduler or waiting for wall-clock time to pass.
 *
 * Production code uses `systemClock`. Tests use `fixedClock`.
 */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}

/** A clock frozen at a instant. */
export function fixedClock(instant: Date | string | number): Clock {
  const frozen = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(frozen.getTime())) {
    throw new Error(`fixedClock: invalid instant ${String(instant)}`)
  }
  return { now: () => new Date(frozen.getTime()) }
}

/** A clock that can be advanced by hand, for multi-step scenarios. */
export function mutableClock(start: Date | string | number) {
  let current = start instanceof Date ? start.getTime() : new Date(start).getTime()
  return {
    now: () => new Date(current),
    advanceBy(ms: number) {
      current += ms
    },
    set(instant: Date | string | number) {
      current = instant instanceof Date ? instant.getTime() : new Date(instant).getTime()
    },
  }
}

// ---------------------------------------------------------------------------
// Local-time helpers
//
// Every one of these takes an explicit IANA zone. There is no "the local
// timezone" in this codebase — the machine's zone is irrelevant, only the
// user's configured zone matters.
// ---------------------------------------------------------------------------

export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

/** `YYYY-MM-DD` in the user's zone. The key for per-day budgets and briefings. */
export function localDateString(instant: Date, zone: string): string {
  const dt = DateTime.fromJSDate(instant, { zone })
  const iso = dt.toISODate()
  if (!iso) throw new Error(`localDateString: invalid zone or instant (${zone})`)
  return iso
}

export function startOfLocalDay(instant: Date, zone: string): Date {
  return DateTime.fromJSDate(instant, { zone }).startOf('day').toJSDate()
}

export function endOfLocalDay(instant: Date, zone: string): Date {
  return DateTime.fromJSDate(instant, { zone }).endOf('day').toJSDate()
}

/** Saturday or Sunday in the user's zone. Drives weekend behavior settings. */
export function isWeekend(instant: Date, zone: string): boolean {
  const weekday = DateTime.fromJSDate(instant, { zone }).weekday
  return weekday === 6 || weekday === 7
}

/**
 * Parses an `HH:MM` wall-clock preference into today's instant in the user's
 * zone. Wall-clock rather than an offset, so "8pm" stays 8pm across DST.
 */
export function localTimeOnDay(instant: Date, zone: string, hhmm: string): Date {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!match) throw new Error(`localTimeOnDay: expected HH:MM, got "${hhmm}"`)

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    throw new Error(`localTimeOnDay: "${hhmm}" is not a valid time of day`)
  }

  return DateTime.fromJSDate(instant, { zone })
    .set({ hour, minute, second: 0, millisecond: 0 })
    .toJSDate()
}

/** Whole days between two instants, measured by local calendar day. */
export function daysBetweenLocal(from: Date, to: Date, zone: string): number {
  const a = DateTime.fromJSDate(from, { zone }).startOf('day')
  const b = DateTime.fromJSDate(to, { zone }).startOf('day')
  return Math.round(b.diff(a, 'days').days)
}

/**
 * Human-friendly relative phrasing used throughout the UI.
 *
 * Deliberately plain and non-alarming: "3 days overdue", never
 * "3 DAYS OVERDUE!!". Tone is part of the product.
 */
export function describeRelativeDay(target: Date, now: Date, zone: string): string {
  const delta = daysBetweenLocal(now, target, zone)
  if (delta === 0) return 'today'
  if (delta === 1) return 'tomorrow'
  if (delta === -1) return 'yesterday'
  if (delta > 1 && delta <= 7) return `in ${delta} days`
  if (delta < -1 && delta >= -7) return `${Math.abs(delta)} days ago`
  return DateTime.fromJSDate(target, { zone }).toFormat('d LLL')
}
