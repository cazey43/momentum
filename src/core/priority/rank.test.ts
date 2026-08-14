import { describe, expect, it } from 'vitest'
import { CTX, daysFromNow, makeItem } from '../../../tests/factories'
import { explain, rankItems, scoreItem, topPriorities } from './rank'

function scoreOf(item: Parameters<typeof scoreItem>[0]): number {
  return scoreItem(item, CTX).reduce((sum, f) => sum + f.weight, 0)
}

describe('scoring', () => {
  it('ranks overdue work above work due later this week', () => {
    const overdue = makeItem({ dueAt: daysFromNow(-3) })
    const soon = makeItem({ dueAt: daysFromNow(4) })
    expect(scoreOf(overdue)).toBeGreaterThan(scoreOf(soon))
  })

  it('escalates with how overdue something is, but caps the escalation', () => {
    const two = scoreOf(makeItem({ dueAt: daysFromNow(-2) }))
    const five = scoreOf(makeItem({ dueAt: daysFromNow(-5) }))
    const ninety = scoreOf(makeItem({ dueAt: daysFromNow(-90) }))

    expect(five).toBeGreaterThan(two)
    // Without a cap, one ancient item would permanently own the top slot.
    expect(ninety).toBe(scoreOf(makeItem({ dueAt: daysFromNow(-30) })))
  })

  it('respects stated importance', () => {
    const high = makeItem({ priority: 'high', dueAt: daysFromNow(3) })
    const low = makeItem({ priority: 'low', dueAt: daysFromNow(3) })
    expect(scoreOf(high)).toBeGreaterThan(scoreOf(low))
  })

  it('penalizes low-confidence inferences so guesses do not outrank facts', () => {
    const recorded = makeItem({ origin: 'user', dueAt: daysFromNow(0) })
    const guessed = makeItem({
      origin: 'ai',
      confidence: 'low',
      reason: 'Detected in an email.',
      dueAt: daysFromNow(0),
    })
    expect(scoreOf(recorded)).toBeGreaterThan(scoreOf(guessed))
  })

  it('raises priority the longer someone has been silent', () => {
    const fresh = makeItem({ kind: 'waiting_for', followUpAt: daysFromNow(-1) })
    const stale = makeItem({ kind: 'waiting_for', followUpAt: daysFromNow(-9) })
    expect(scoreOf(stale)).toBeGreaterThan(scoreOf(fresh))
  })

  it('flags work that has sat in progress without an update', () => {
    const stalled = makeItem({
      status: 'in_progress',
      updatedAt: daysFromNow(-30),
      createdAt: daysFromNow(-40),
    })
    const keys = scoreItem(stalled, CTX).map((f) => f.key)
    expect(keys).toContain('stale_in_progress')
  })

  it('pushes someday items far down', () => {
    expect(scoreOf(makeItem({ kind: 'someday', dueAt: daysFromNow(-5) }))).toBeLessThan(0)
  })
})

describe('explain', () => {
  it('gives a plain-language reason, not a score', () => {
    const item = makeItem({ dueAt: daysFromNow(-2) })
    const reason = explain(scoreItem(item, CTX))
    expect(reason).toBe('This was due 2 days ago.')
    expect(reason).not.toMatch(/\d+\s*points|score/i)
  })

  it('names the person when the delay is theirs', () => {
    const item = makeItem({
      kind: 'waiting_for',
      counterpartName: 'Dana',
      followUpAt: daysFromNow(-5),
    })
    expect(explain(scoreItem(item, CTX))).toContain('waiting on Dana for 5 days')
  })

  it('always attaches the caveat when the item was inferred', () => {
    // The app must never state an inference as though it were a fact.
    const item = makeItem({
      origin: 'ai',
      confidence: 'low',
      reason: 'Detected in an email.',
      dueAt: daysFromNow(-3),
    })
    expect(explain(scoreItem(item, CTX))).toMatch(/may not be right/)
  })

  it('says so plainly when nothing is pressing', () => {
    expect(explain(scoreItem(makeItem(), CTX))).toBe('No time pressure on this one.')
  })
})

describe('rankItems', () => {
  it('breaks ties by age, oldest first', () => {
    const older = makeItem({ dueAt: daysFromNow(0), createdAt: daysFromNow(-20) })
    const newer = makeItem({ dueAt: daysFromNow(0), createdAt: daysFromNow(-2) })
    const ranked = rankItems([newer, older], CTX)
    expect(ranked[0]?.item.id).toBe(older.id)
  })
})

describe('topPriorities', () => {
  it('returns at most three', () => {
    const items = Array.from({ length: 8 }, () => makeItem({ dueAt: daysFromNow(-1) }))
    expect(topPriorities(items, CTX)).toHaveLength(3)
  })

  it('never pads to three when only two are genuinely pressing', () => {
    // Two real priorities beats three with filler.
    const items = [
      makeItem({ dueAt: daysFromNow(-1) }),
      makeItem({ dueAt: daysFromNow(0) }),
      makeItem({ dueAt: daysFromNow(30) }),
      makeItem({ kind: 'someday' }),
    ]
    expect(topPriorities(items, CTX)).toHaveLength(2)
  })

  it('excludes things the user cannot act on', () => {
    const items = [
      makeItem({ kind: 'waiting_for', followUpAt: daysFromNow(-10) }),
      makeItem({ snoozedUntil: daysFromNow(3), dueAt: daysFromNow(-3) }),
      makeItem({ status: 'done', dueAt: daysFromNow(-3) }),
    ]
    expect(topPriorities(items, CTX)).toHaveLength(0)
  })

  it('carries a reason for every item it returns', () => {
    const items = [makeItem({ dueAt: daysFromNow(-1) }), makeItem({ dueAt: daysFromNow(0) })]
    for (const ranked of topPriorities(items, CTX)) {
      expect(ranked.reason.length).toBeGreaterThan(0)
    }
  })
})
