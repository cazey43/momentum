import { describe, expect, it } from 'vitest'
import { daysFromNow, makeItem, ZONE } from '../../../tests/factories'
import type { PolicyPreferences, PolicyState } from './persistence'
import {
  chooseOnePrompt,
  decideForItem,
  escalationFor,
  hashBody,
  isWithinQuietHours,
  planNudges,
} from './persistence'

const PREFS: PolicyPreferences = {
  timezone: ZONE,
  quietHoursStart: '20:00',
  quietHoursEnd: '08:00',
  dailyNudgeBudget: 2,
  reminderIntensity: 'gentle',
  proactiveRemindersPaused: false,
  weekendReminders: false,
}

const STATE: PolicyState = {
  nudgesDeliveredToday: 0,
  ignoredStreak: 0,
  usedBodyHashes: new Set<string>(),
}

/** Thursday 13 Aug 2026, 11:00 EDT — a weekday, outside quiet hours. */
const NOW = new Date('2026-08-13T15:00:00Z')
const CTX = { now: NOW, zone: ZONE }

const BODY = 'The Northwind contract is past the date you gave Dana.'

function decide(item = makeItem({ dueAt: daysFromNow(-1) }), overrides: Partial<PolicyState> = {}) {
  return decideForItem(item, CTX, PREFS, { ...STATE, ...overrides }, BODY)
}

describe('quiet hours', () => {
  const at = (iso: string) => new Date(iso)

  it('is quiet late in the evening', () => {
    // 22:00 EDT
    expect(isWithinQuietHours(at('2026-08-14T02:00:00Z'), PREFS)).toBe(true)
  })

  it('is quiet in the small hours — the case a naive range check gets wrong', () => {
    // 03:00 EDT, which is after midnight and so is neither ">= 20:00" nor
    // "<= 08:00" on the same calendar day.
    expect(isWithinQuietHours(at('2026-08-14T07:00:00Z'), PREFS)).toBe(true)
  })

  it('is not quiet mid-morning', () => {
    expect(isWithinQuietHours(at('2026-08-13T15:00:00Z'), PREFS)).toBe(false)
  })

  it('opens up exactly at the end boundary', () => {
    // 08:00 EDT precisely — quiet hours have ended.
    expect(isWithinQuietHours(at('2026-08-13T12:00:00Z'), PREFS)).toBe(false)
  })

  it('closes exactly at the start boundary', () => {
    // 20:00 EDT precisely — quiet hours have begun.
    expect(isWithinQuietHours(at('2026-08-14T00:00:00Z'), PREFS)).toBe(true)
  })

  it('holds the same wall-clock boundary across a DST change', () => {
    // 22:00 local in January and in July are different UTC instants; both quiet.
    expect(isWithinQuietHours(at('2026-01-15T03:00:00Z'), PREFS)).toBe(true)
    expect(isWithinQuietHours(at('2026-07-15T02:00:00Z'), PREFS)).toBe(true)
  })

  it('suppresses a nudge during quiet hours', () => {
    const quietPrefsCtx = { now: at('2026-08-14T03:00:00Z'), zone: ZONE }
    const decision = decideForItem(
      makeItem({ dueAt: daysFromNow(-2) }),
      quietPrefsCtx,
      PREFS,
      STATE,
      BODY,
    )
    expect(decision.deliver).toBe(false)
    expect(decision.suppressionReason).toBe('quiet_hours')
  })
})

describe('the global pause', () => {
  it('silences everything, however urgent', () => {
    const item = makeItem({ dueAt: daysFromNow(-30), priority: 'high' })
    const decision = decideForItem(
      item,
      CTX,
      { ...PREFS, proactiveRemindersPaused: true },
      STATE,
      BODY,
    )
    expect(decision.deliver).toBe(false)
    expect(decision.suppressionReason).toBe('globally_paused')
  })
})

describe('the daily nudge budget', () => {
  it('allows a nudge when budget remains', () => {
    expect(decide(makeItem({ dueAt: daysFromNow(-1) }), { nudgesDeliveredToday: 1 }).deliver).toBe(
      true,
    )
  })

  it('stops once the budget is spent', () => {
    const decision = decide(makeItem({ dueAt: daysFromNow(-1) }), { nudgesDeliveredToday: 2 })
    expect(decision.deliver).toBe(false)
    expect(decision.suppressionReason).toBe('budget_exhausted')
  })

  it('honors a budget of zero', () => {
    const decision = decideForItem(
      makeItem({ dueAt: daysFromNow(-1) }),
      CTX,
      { ...PREFS, dailyNudgeBudget: 0 },
      STATE,
      BODY,
    )
    expect(decision.deliver).toBe(false)
  })
})

describe('respecting what the user said', () => {
  it('honors "stop reminding me about this"', () => {
    const decision = decide(makeItem({ dueAt: daysFromNow(-5), remindersMuted: true }))
    expect(decision.suppressionReason).toBe('item_muted')
  })

  it('honors "only remind me once" after the first reminder', () => {
    const first = decide(makeItem({ dueAt: daysFromNow(-5), remindOnce: true, nudgeCount: 0 }))
    expect(first.deliver).toBe(true)

    const second = decide(makeItem({ dueAt: daysFromNow(-5), remindOnce: true, nudgeCount: 1 }))
    expect(second.deliver).toBe(false)
    expect(second.suppressionReason).toBe('remind_once_already_used')
  })

  it('honors an active snooze', () => {
    const decision = decide(makeItem({ dueAt: daysFromNow(-5), snoozedUntil: daysFromNow(2) }))
    expect(decision.suppressionReason).toBe('snoozed')
  })

  it('goes quiet about anything opened or discussed today', () => {
    const decision = decide(makeItem({ dueAt: daysFromNow(-5), lastEngagedAt: NOW }))
    expect(decision.suppressionReason).toBe('recently_engaged')
  })

  it('says nothing about completed work', () => {
    expect(decide(makeItem({ dueAt: daysFromNow(-5), status: 'done' })).suppressionReason).toBe(
      'closed',
    )
  })
})

describe('never repeating itself', () => {
  it('suppresses wording already used', () => {
    const decision = decide(makeItem({ dueAt: daysFromNow(-2) }), {
      usedBodyHashes: new Set([hashBody(BODY)]),
    })
    expect(decision.deliver).toBe(false)
    expect(decision.suppressionReason).toBe('duplicate_wording')
  })

  it('hashes case- and whitespace-insensitively', () => {
    expect(hashBody('  Hello There  ')).toBe(hashBody('hello there'))
  })
})

describe('after two ignored nudges', () => {
  it('stops nudging and hands control back', () => {
    const decision = decide(makeItem({ dueAt: daysFromNow(-5) }), { ignoredStreak: 2 })
    expect(decision.deliver).toBe(false)
    expect(decision.suppressionReason).toBe('awaiting_user_direction')
  })

  it('still nudges after a single ignored one', () => {
    expect(decide(makeItem({ dueAt: daysFromNow(-5) }), { ignoredStreak: 1 }).deliver).toBe(true)
  })
})

describe('weekends', () => {
  it('stays quiet by default', () => {
    const saturday = { now: new Date('2026-08-15T16:00:00Z'), zone: ZONE }
    const decision = decideForItem(
      makeItem({ dueAt: daysFromNow(-3) }),
      saturday,
      PREFS,
      STATE,
      BODY,
    )
    expect(decision.suppressionReason).toBe('weekend')
  })

  it('speaks up when the user has enabled weekend reminders', () => {
    const saturday = { now: new Date('2026-08-15T16:00:00Z'), zone: ZONE }
    const decision = decideForItem(
      makeItem({ dueAt: new Date('2026-08-14T16:00:00Z') }),
      saturday,
      { ...PREFS, weekendReminders: true },
      STATE,
      BODY,
    )
    expect(decision.deliver).toBe(true)
  })
})

describe('escalation', () => {
  it('reserves urgent for a real, imminent, high-impact deadline', () => {
    expect(escalationFor(makeItem({ priority: 'high', dueAt: daysFromNow(-1) }), CTX)).toBe(
      'urgent',
    )
    expect(escalationFor(makeItem({ priority: 'normal', dueAt: daysFromNow(-1) }), CTX)).toBe(
      'direct',
    )
  })

  it('does not escalate merely because something was ignored', () => {
    const ignored = makeItem({ priority: 'normal', dueAt: daysFromNow(-1), nudgeCount: 9 })
    expect(escalationFor(ignored, CTX)).toBe('direct')
  })

  it('keeps someday items silent', () => {
    expect(escalationFor(makeItem({ kind: 'someday' }), CTX)).toBe('silent')
  })
})

describe('planNudges', () => {
  const bodyFor = (item: { title: string }) => `About ${item.title}`

  it('bundles low-urgency items instead of sending several', () => {
    const items = [
      makeItem({ kind: 'waiting_for', followUpAt: daysFromNow(-8), title: 'a' }),
      makeItem({ kind: 'waiting_for', followUpAt: daysFromNow(-9), title: 'b' }),
    ]
    const plan = planNudges(items, CTX, PREFS, STATE, bodyFor)

    expect(plan.bundled).toHaveLength(2)
    expect(plan.deliver).toHaveLength(0)
  })

  it('asks the user to choose one when several things are pressing', () => {
    const items = [
      makeItem({ priority: 'high', dueAt: daysFromNow(-2), title: 'a' }),
      makeItem({ priority: 'high', dueAt: daysFromNow(-3), title: 'b' }),
      makeItem({ priority: 'high', dueAt: daysFromNow(-4), title: 'c' }),
    ]
    const plan = planNudges(items, CTX, PREFS, STATE, bodyFor)

    expect(plan.askToChooseOne).toHaveLength(3)
    expect(plan.deliver).toHaveLength(0)
    expect(chooseOnePrompt(plan.askToChooseOne)).toMatch(/which would you like/i)
  })

  it('never exceeds the daily budget', () => {
    const items = Array.from({ length: 2 }, (_, i) =>
      makeItem({ dueAt: daysFromNow(-2), title: `item ${i}` }),
    )
    const plan = planNudges(items, CTX, { ...PREFS, dailyNudgeBudget: 1 }, STATE, bodyFor)

    expect(plan.deliver).toHaveLength(1)
    expect(plan.suppressed.some((s) => s.reason === 'budget_exhausted')).toBe(true)
  })

  it('delivers nothing at all when globally paused', () => {
    const items = [makeItem({ priority: 'high', dueAt: daysFromNow(-9) })]
    const plan = planNudges(
      items,
      CTX,
      { ...PREFS, proactiveRemindersPaused: true },
      STATE,
      bodyFor,
    )

    expect(plan.deliver).toHaveLength(0)
    expect(plan.bundled).toHaveLength(0)
    expect(plan.askToChooseOne).toHaveLength(0)
  })

  it('records why each suppressed item was suppressed', () => {
    const items = [makeItem({ dueAt: daysFromNow(-3), remindersMuted: true })]
    const plan = planNudges(items, CTX, PREFS, STATE, bodyFor)
    expect(plan.suppressed[0]?.reason).toBe('item_muted')
  })

  it('does not repeat wording within one round', () => {
    const items = [
      makeItem({ dueAt: daysFromNow(-2), title: 'same' }),
      makeItem({ dueAt: daysFromNow(-2), title: 'same' }),
    ]
    const plan = planNudges(items, CTX, PREFS, STATE, () => 'Identical wording')
    expect(plan.deliver).toHaveLength(1)
    expect(plan.suppressed.some((s) => s.reason === 'duplicate_wording')).toBe(true)
  })
})
