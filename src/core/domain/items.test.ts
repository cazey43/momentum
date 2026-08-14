import { describe, expect, it } from 'vitest'
import { CTX, daysFromNow, makeItem, NOW, ZONE } from '../../../tests/factories'
import {
  applyTransition,
  bucketOf,
  computeDedupeKey,
  daysOverdue,
  daysWaiting,
  isActionable,
  normalizeTitle,
} from './items'

describe('normalizeTitle', () => {
  it('collapses casing, punctuation, and spacing', () => {
    expect(normalizeTitle('Send  the CONTRACT, to Dana!')).toBe('send the contract to dana')
  })

  it('strips commitment openers so phrasing does not create duplicates', () => {
    expect(normalizeTitle("I'll send the contract")).toBe('send the contract')
    expect(normalizeTitle('I will send the contract')).toBe('send the contract')
    expect(normalizeTitle('Remember to send the contract')).toBe('send the contract')
  })

  it('does not drop content words', () => {
    // Over-merging distinct commitments is worse than a near-duplicate.
    expect(normalizeTitle('send the contract to Dana')).not.toBe(
      normalizeTitle('send the invoice to Dana'),
    )
  })
})

describe('computeDedupeKey', () => {
  const base = { kind: 'commitment' as const, title: 'Send the contract', zone: ZONE }

  it('is stable across runs, so re-syncing an email creates no duplicate', () => {
    expect(computeDedupeKey(base)).toBe(computeDedupeKey(base))
  })

  it('treats differently-phrased versions of one commitment as the same item', () => {
    expect(computeDedupeKey({ ...base, title: "I'll send the contract" })).toBe(
      computeDedupeKey({ ...base, title: 'Send the contract.' }),
    )
  })

  it('ignores time-of-day differences on the due date', () => {
    const morning = computeDedupeKey({ ...base, dueAt: new Date('2026-08-20T13:00:00Z') })
    const evening = computeDedupeKey({ ...base, dueAt: new Date('2026-08-20T21:00:00Z') })
    expect(morning).toBe(evening)
  })

  it('separates the same commitment owed to different people', () => {
    expect(computeDedupeKey({ ...base, counterpartEmail: 'dana@example.com' })).not.toBe(
      computeDedupeKey({ ...base, counterpartEmail: 'sam@example.com' }),
    )
  })

  it('separates different kinds of the same wording', () => {
    expect(computeDedupeKey({ ...base, kind: 'task' })).not.toBe(
      computeDedupeKey({ ...base, kind: 'commitment' }),
    )
  })
})

describe('bucketOf', () => {
  it('puts a past due date in overdue', () => {
    expect(bucketOf(makeItem({ dueAt: daysFromNow(-2) }), CTX)).toBe('overdue')
  })

  it('puts a due date later today in today', () => {
    expect(bucketOf(makeItem({ dueAt: new Date('2026-08-13T22:00:00Z') }), CTX)).toBe('today')
  })

  it('lets an active snooze override a due date, because the user said not now', () => {
    const item = makeItem({ dueAt: daysFromNow(-5), snoozedUntil: daysFromNow(2) })
    expect(bucketOf(item, CTX)).toBe('snoozed')
  })

  it('stops honoring a snooze once it has expired', () => {
    const item = makeItem({ dueAt: daysFromNow(-5), snoozedUntil: daysFromNow(-1) })
    expect(bucketOf(item, CTX)).toBe('overdue')
  })

  it('never calls a completed item overdue', () => {
    const item = makeItem({ status: 'done', dueAt: daysFromNow(-9) })
    expect(bucketOf(item, CTX)).toBe('completed')
  })

  it('files waiting-on-others under waiting, not overdue', () => {
    // Surfacing this as "overdue" would blame the user for someone else's delay.
    const item = makeItem({ kind: 'waiting_for', dueAt: daysFromNow(-4) })
    expect(bucketOf(item, CTX)).toBe('waiting')
  })

  it('keeps someday and notes out of the active buckets', () => {
    expect(bucketOf(makeItem({ kind: 'someday' }), CTX)).toBe('someday')
    expect(bucketOf(makeItem({ kind: 'note' }), CTX)).toBe('someday')
  })

  it('treats untriaged captures as inbox', () => {
    expect(bucketOf(makeItem({ status: 'inbox' }), CTX)).toBe('inbox')
  })
})

describe('isActionable', () => {
  it('excludes snoozed, completed, and someday items', () => {
    expect(isActionable(makeItem({ snoozedUntil: daysFromNow(1) }), CTX)).toBe(false)
    expect(isActionable(makeItem({ status: 'done' }), CTX)).toBe(false)
    expect(isActionable(makeItem({ kind: 'someday' }), CTX)).toBe(false)
  })

  it('includes overdue and due-today work', () => {
    expect(isActionable(makeItem({ dueAt: daysFromNow(-1) }), CTX)).toBe(true)
  })
})

describe('daysOverdue / daysWaiting', () => {
  it('reports whole days overdue and never a negative number', () => {
    expect(daysOverdue(makeItem({ dueAt: daysFromNow(-3) }), CTX)).toBe(3)
    expect(daysOverdue(makeItem({ dueAt: daysFromNow(3) }), CTX)).toBe(0)
  })

  it('counts waiting time from the follow-up date', () => {
    const item = makeItem({ kind: 'waiting_for', followUpAt: daysFromNow(-6) })
    expect(daysWaiting(item, CTX)).toBe(6)
  })

  it('reports no waiting time for items the user owns', () => {
    expect(daysWaiting(makeItem({ kind: 'task', followUpAt: daysFromNow(-6) }), CTX)).toBe(0)
  })
})

describe('applyTransition', () => {
  it('completes an open item and stamps the completion time', () => {
    const result = applyTransition(makeItem(), { type: 'complete' }, CTX)
    expect(result.ok).toBe(true)
    expect(result.changes?.status).toBe('done')
    expect(result.changes?.completedAt).toEqual(NOW)
  })

  it('clears a snooze on completion, so nothing lingers scheduled', () => {
    const item = makeItem({ status: 'snoozed', snoozedUntil: daysFromNow(3) })
    const result = applyTransition(item, { type: 'complete' }, CTX)
    expect(result.changes?.snoozedUntil).toBeNull()
  })

  it('refuses to snooze into the past', () => {
    const result = applyTransition(makeItem(), { type: 'snooze', until: daysFromNow(-1) }, CTX)
    expect(result.ok).toBe(false)
    expect(result.problem).toMatch(/future/i)
  })

  it('records snoozing as engagement, which suppresses further nudging', () => {
    const result = applyTransition(makeItem(), { type: 'snooze', until: daysFromNow(2) }, CTX)
    expect(result.ok).toBe(true)
    expect(result.changes?.lastEngagedAt).toEqual(NOW)
  })

  it('will not re-complete an already completed item', () => {
    const result = applyTransition(makeItem({ status: 'done' }), { type: 'complete' }, CTX)
    expect(result.ok).toBe(false)
    expect(result.problem).toMatch(/already done/i)
  })

  it('reopens a completed item and clears the completion stamp', () => {
    const result = applyTransition(makeItem({ status: 'done' }), { type: 'reopen' }, CTX)
    expect(result.ok).toBe(true)
    expect(result.changes?.status).toBe('open')
    expect(result.changes?.completedAt).toBeNull()
  })

  it('only allows triage out of the inbox', () => {
    const fromInbox = applyTransition(
      makeItem({ status: 'inbox' }),
      { type: 'triage', to: 'open' },
      CTX,
    )
    expect(fromInbox.ok).toBe(true)

    const fromOpen = applyTransition(
      makeItem({ status: 'open' }),
      { type: 'triage', to: 'open' },
      CTX,
    )
    expect(fromOpen.ok).toBe(false)
  })

  it('writes an audit description for every successful change', () => {
    const result = applyTransition(makeItem(), { type: 'snooze', until: daysFromNow(2) }, CTX)
    expect(result.auditAction).toMatch(/snoozed until 2026-08-15/)
  })

  it('phrases refusals for the user, not the developer', () => {
    const result = applyTransition(makeItem({ status: 'dismissed' }), { type: 'start' }, CTX)
    expect(result.problem).not.toMatch(/invalid|error|exception/i)
  })
})
