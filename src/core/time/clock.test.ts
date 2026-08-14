import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import {
  daysBetweenLocal,
  describeRelativeDay,
  fixedClock,
  isWeekend,
  localDateString,
  localTimeOnDay,
  mutableClock,
} from './clock'

const ZONE = 'America/Detroit'

describe('fixedClock', () => {
  it('returns the same instant every time', () => {
    const clock = fixedClock('2026-08-13T15:00:00Z')
    expect(clock.now().toISOString()).toBe('2026-08-13T15:00:00.000Z')
    expect(clock.now().toISOString()).toBe('2026-08-13T15:00:00.000Z')
  })

  it('hands out copies, so a caller cannot mutate the clock', () => {
    const clock = fixedClock('2026-08-13T15:00:00Z')
    const first = clock.now()
    first.setFullYear(1999)
    expect(clock.now().getFullYear()).toBe(2026)
  })

  it('rejects an invalid instant rather than silently returning Invalid Date', () => {
    expect(() => fixedClock('not a date')).toThrow(/invalid instant/i)
  })
})

describe('mutableClock', () => {
  it('advances by the requested amount', () => {
    const clock = mutableClock('2026-08-13T15:00:00Z')
    clock.advanceBy(2 * 60 * 60 * 1000)
    expect(clock.now().toISOString()).toBe('2026-08-13T17:00:00.000Z')
  })
})

describe('localDateString', () => {
  it('uses the user zone, not UTC, to decide which day it is', () => {
    // 02:00 UTC on the 14th is still 22:00 on the 13th in Detroit.
    const instant = new Date('2026-08-14T02:00:00Z')
    expect(localDateString(instant, ZONE)).toBe('2026-08-13')
    expect(localDateString(instant, 'UTC')).toBe('2026-08-14')
  })
})

describe('localTimeOnDay', () => {
  it('keeps quiet hours at 8pm wall-clock through a DST change', () => {
    // This is the whole reason preferences store "20:00" and not an offset.
    const winter = localTimeOnDay(new Date('2026-01-15T12:00:00Z'), ZONE, '20:00')
    const summer = localTimeOnDay(new Date('2026-07-15T12:00:00Z'), ZONE, '20:00')

    expect(DateTime.fromJSDate(winter, { zone: ZONE }).hour).toBe(20)
    expect(DateTime.fromJSDate(summer, { zone: ZONE }).hour).toBe(20)

    // ...and they are genuinely different UTC instants, proving the offset moved.
    expect(winter.toISOString()).not.toBe(summer.toISOString())
  })

  it('rejects malformed times instead of guessing', () => {
    const day = new Date('2026-08-13T15:00:00Z')
    expect(() => localTimeOnDay(day, ZONE, '8pm')).toThrow(/HH:MM/)
    expect(() => localTimeOnDay(day, ZONE, '25:00')).toThrow(/not a valid time/)
  })
})

describe('isWeekend', () => {
  it('identifies Saturday and Sunday in the user zone', () => {
    expect(isWeekend(new Date('2026-08-15T16:00:00Z'), ZONE)).toBe(true) // Sat
    expect(isWeekend(new Date('2026-08-16T16:00:00Z'), ZONE)).toBe(true) // Sun
    expect(isWeekend(new Date('2026-08-13T16:00:00Z'), ZONE)).toBe(false) // Thu
  })

  it('uses the user zone for the boundary', () => {
    // 01:00 UTC Monday is still Sunday evening in Detroit.
    expect(isWeekend(new Date('2026-08-17T01:00:00Z'), ZONE)).toBe(true)
    expect(isWeekend(new Date('2026-08-17T01:00:00Z'), 'UTC')).toBe(false)
  })
})

describe('daysBetweenLocal', () => {
  it('counts calendar days, not elapsed 24-hour periods', () => {
    const late = new Date('2026-08-13T23:30:00-04:00')
    const earlyNext = new Date('2026-08-14T00:30:00-04:00')
    // One hour apart, but a day apart on the calendar.
    expect(daysBetweenLocal(late, earlyNext, ZONE)).toBe(1)
  })

  it('is negative when the target is in the past', () => {
    const now = new Date('2026-08-13T15:00:00Z')
    const past = new Date('2026-08-10T15:00:00Z')
    expect(daysBetweenLocal(now, past, ZONE)).toBe(-3)
  })
})

describe('describeRelativeDay', () => {
  const now = new Date('2026-08-13T15:00:00Z')

  it('uses calm, plain phrasing', () => {
    expect(describeRelativeDay(now, now, ZONE)).toBe('today')
    expect(describeRelativeDay(new Date('2026-08-14T15:00:00Z'), now, ZONE)).toBe('tomorrow')
    expect(describeRelativeDay(new Date('2026-08-12T15:00:00Z'), now, ZONE)).toBe('yesterday')
    expect(describeRelativeDay(new Date('2026-08-16T15:00:00Z'), now, ZONE)).toBe('in 3 days')
    expect(describeRelativeDay(new Date('2026-08-10T15:00:00Z'), now, ZONE)).toBe('3 days ago')
  })

  it('falls back to a date for anything beyond a week', () => {
    expect(describeRelativeDay(new Date('2026-09-20T15:00:00Z'), now, ZONE)).toBe('20 Sep')
  })
})
