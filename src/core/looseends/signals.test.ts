import { describe, expect, it } from 'vitest'
import { CTX, daysFromNow, makeItem } from '../../../tests/factories'
import {
  DEFAULT_THRESHOLDS,
  detectStructuralLooseEnds,
  isAccusatory,
  orderCandidates,
} from './signals'

describe('detectStructuralLooseEnds', () => {
  it('surfaces a waiting-for item after a reasonable silence', () => {
    const item = makeItem({
      kind: 'waiting_for',
      counterpartName: 'Dana',
      followUpAt: daysFromNow(-7),
    })
    const found = detectStructuralLooseEnds([item], CTX)
    expect(found).toHaveLength(1)
    expect(found[0]?.signal).toBe('stale_waiting')
    expect(found[0]?.headline).toContain('Dana')
  })

  it('stays quiet before the threshold', () => {
    const item = makeItem({ kind: 'waiting_for', followUpAt: daysFromNow(-2) })
    expect(detectStructuralLooseEnds([item], CTX)).toHaveLength(0)
  })

  it('raises confidence as the silence lengthens', () => {
    const recent = makeItem({ kind: 'waiting_for', followUpAt: daysFromNow(-6) })
    const ancient = makeItem({ kind: 'waiting_for', followUpAt: daysFromNow(-40) })
    expect(detectStructuralLooseEnds([recent], CTX)[0]?.confidence).toBe('medium')
    expect(detectStructuralLooseEnds([ancient], CTX)[0]?.confidence).toBe('high')
  })

  it('flags a delegated item with no recorded outcome', () => {
    const item = makeItem({
      kind: 'delegated',
      counterpartName: 'Jordan',
      followUpAt: daysFromNow(-10),
    })
    expect(detectStructuralLooseEnds([item], CTX)[0]?.signal).toBe('delegated_no_outcome')
  })

  it('flags work stuck in progress', () => {
    const item = makeItem({
      status: 'in_progress',
      updatedAt: daysFromNow(-20),
      createdAt: daysFromNow(-30),
    })
    expect(detectStructuralLooseEnds([item], CTX)[0]?.signal).toBe('stale_in_progress')
  })

  it('notices a pattern of postponement', () => {
    const item = makeItem({ nudgeCount: 4, lastNudgedAt: daysFromNow(-1) })
    expect(detectStructuralLooseEnds([item], CTX)[0]?.signal).toBe('repeatedly_postponed')
  })

  it('flags captures that were never sorted', () => {
    const item = makeItem({ status: 'inbox', createdAt: daysFromNow(-6) })
    const found = detectStructuralLooseEnds([item], CTX)
    expect(found[0]?.signal).toBe('untriaged_too_long')
    // Weak evidence, so it must not claim confidence it does not have.
    expect(found[0]?.confidence).toBe('low')
  })
})

describe('suppression — the difference between helpful and nagging', () => {
  it('says nothing about an item the user muted', () => {
    const item = makeItem({
      kind: 'waiting_for',
      followUpAt: daysFromNow(-30),
      remindersMuted: true,
    })
    expect(detectStructuralLooseEnds([item], CTX)).toHaveLength(0)
  })

  it('says nothing about an actively snoozed item', () => {
    const item = makeItem({
      kind: 'waiting_for',
      followUpAt: daysFromNow(-30),
      snoozedUntil: daysFromNow(4),
    })
    expect(detectStructuralLooseEnds([item], CTX)).toHaveLength(0)
  })

  it('resumes once the snooze has expired', () => {
    const item = makeItem({
      kind: 'waiting_for',
      followUpAt: daysFromNow(-30),
      snoozedUntil: daysFromNow(-1),
    })
    expect(detectStructuralLooseEnds([item], CTX)).toHaveLength(1)
  })

  it('says nothing about something the user just engaged with', () => {
    const item = makeItem({
      kind: 'waiting_for',
      followUpAt: daysFromNow(-30),
      lastEngagedAt: CTX.now,
    })
    expect(detectStructuralLooseEnds([item], CTX)).toHaveLength(0)
  })

  it('says nothing about completed or dismissed work', () => {
    const done = makeItem({ kind: 'waiting_for', followUpAt: daysFromNow(-30), status: 'done' })
    const dropped = makeItem({
      kind: 'waiting_for',
      followUpAt: daysFromNow(-30),
      status: 'dismissed',
    })
    expect(detectStructuralLooseEnds([done, dropped], CTX)).toHaveLength(0)
  })

  it('raises at most one candidate per item', () => {
    // An item can trip several detectors; showing it three times would be
    // three separate naggings about one thing.
    const item = makeItem({
      kind: 'waiting_for',
      status: 'in_progress',
      followUpAt: daysFromNow(-30),
      updatedAt: daysFromNow(-30),
      nudgeCount: 9,
    })
    expect(detectStructuralLooseEnds([item], CTX)).toHaveLength(1)
  })
})

describe('tone', () => {
  it('never blames the user in generated copy', () => {
    const items = [
      makeItem({ kind: 'waiting_for', counterpartName: 'Dana', followUpAt: daysFromNow(-20) }),
      makeItem({ kind: 'delegated', followUpAt: daysFromNow(-20) }),
      makeItem({ status: 'in_progress', updatedAt: daysFromNow(-30) }),
      makeItem({ nudgeCount: 5 }),
      makeItem({ status: 'inbox', createdAt: daysFromNow(-10) }),
    ]

    for (const candidate of detectStructuralLooseEnds(items, CTX)) {
      expect(isAccusatory(candidate.headline)).toBe(false)
      expect(isAccusatory(candidate.why)).toBe(false)
      expect(isAccusatory(candidate.suggestedAction)).toBe(false)
    }
  })

  it('hedges rather than asserting', () => {
    const item = makeItem({ kind: 'waiting_for', followUpAt: daysFromNow(-9) })
    const candidate = detectStructuralLooseEnds([item], CTX)[0]
    expect(candidate?.headline).toMatch(/\bmay\b|\bmight\b|\bpossibl/i)
  })

  it('always offers a next step', () => {
    const item = makeItem({ kind: 'waiting_for', followUpAt: daysFromNow(-9) })
    expect(detectStructuralLooseEnds([item], CTX)[0]?.suggestedAction.length).toBeGreaterThan(0)
  })

  it('detects accusatory phrasing when it appears', () => {
    expect(isAccusatory('You forgot to reply to Dana')).toBe(true)
    expect(isAccusatory('You are behind on three things')).toBe(true)
    expect(isAccusatory('URGENT: reply now')).toBe(true)
    expect(isAccusatory('Dana may not have replied yet')).toBe(false)
  })
})

describe('orderCandidates', () => {
  it('leads with the strongest evidence', () => {
    const items = [
      makeItem({ status: 'inbox', createdAt: daysFromNow(-10) }), // low
      makeItem({ kind: 'waiting_for', followUpAt: daysFromNow(-40) }), // high
    ]
    const ordered = orderCandidates(detectStructuralLooseEnds(items, CTX))
    expect(ordered[0]?.confidence).toBe('high')
  })
})

describe('thresholds', () => {
  it('are configurable rather than hardcoded', () => {
    const item = makeItem({ kind: 'waiting_for', followUpAt: daysFromNow(-3) })
    expect(detectStructuralLooseEnds([item], CTX)).toHaveLength(0)
    expect(
      detectStructuralLooseEnds([item], CTX, { ...DEFAULT_THRESHOLDS, staleWaitingDays: 2 }),
    ).toHaveLength(1)
  })
})
