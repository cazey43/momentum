import type { DomainItem } from '@/core/domain/items'

let counter = 0

/**
 * Builds a DomainItem with sensible defaults so each test states only the
 * fields it actually cares about. Keeps the intent of a test visible instead
 * of burying it in twenty lines of boilerplate.
 */
export function makeItem(overrides: Partial<DomainItem> = {}): DomainItem {
  counter += 1
  const created = overrides.createdAt ?? new Date('2026-08-01T12:00:00Z')
  return {
    id: `item_${counter}`,
    kind: 'task',
    status: 'open',
    priority: 'normal',
    title: `Test item ${counter}`,
    detail: null,
    dueAt: null,
    followUpAt: null,
    snoozedUntil: null,
    counterpartName: null,
    counterpartEmail: null,
    project: null,
    origin: 'user',
    confidence: null,
    reason: null,
    remindOnce: false,
    remindersMuted: false,
    nudgeCount: 0,
    lastNudgedAt: null,
    lastEngagedAt: null,
    isDemo: false,
    createdAt: created,
    updatedAt: created,
    completedAt: null,
    ...overrides,
  }
}

/** Detroit, per the user's configured zone. */
export const ZONE = 'America/Detroit'

/** 13 Aug 2026, 11:00 EDT. Fixed reference "now" for the suite. */
export const NOW = new Date('2026-08-13T15:00:00Z')

export const CTX = { now: NOW, zone: ZONE }

export function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000)
}
