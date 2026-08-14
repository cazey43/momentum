/**
 * The vocabulary of the domain.
 *
 * This module is deliberately the deepest layer: it has no imports at all.
 * The database schema imports these unions rather than declaring its own, so
 * there is exactly one definition of what an "item kind" is, and adding a new
 * one is a single edit that the compiler then chases through the codebase.
 */

export const ITEM_KINDS = [
  'task',
  'commitment', // something I said I would do
  'waiting_for', // something someone else owes me
  'delegated', // something I handed off
  'follow_up',
  'someday',
  'note',
] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

export const ITEM_STATUSES = [
  'inbox', // captured, not yet triaged
  'open',
  'in_progress',
  'blocked',
  'snoozed',
  'done',
  'dismissed',
] as const
export type ItemStatus = (typeof ITEM_STATUSES)[number]

export const PRIORITIES = ['low', 'normal', 'high'] as const
export type Priority = (typeof PRIORITIES)[number]

/** How a row came to exist. Drives the evidence requirements on items. */
export const ORIGINS = ['user', 'ai', 'system'] as const
export type Origin = (typeof ORIGINS)[number]

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

/** Escalation ladder from the Gentle Persistence Policy. */
export const REMINDER_LEVELS = ['silent', 'gentle', 'direct', 'urgent'] as const
export type ReminderLevel = (typeof REMINDER_LEVELS)[number]

export const DRAFT_STATUSES = [
  'suggested',
  'drafted',
  'approved',
  'sent',
  'dismissed',
  'snoozed',
] as const
export type DraftStatus = (typeof DRAFT_STATUSES)[number]

export const SOURCE_KINDS = ['email', 'calendar', 'task', 'note', 'conversation', 'manual'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

/** Kinds where the next move belongs to someone else, not the user. */
export const AWAITING_OTHERS_KINDS: readonly ItemKind[] = ['waiting_for', 'delegated']

/** Kinds that never appear in Today and never generate a nudge. */
export const PASSIVE_KINDS: readonly ItemKind[] = ['someday', 'note']

/** Statuses that take an item out of active circulation. */
export const CLOSED_STATUSES: readonly ItemStatus[] = ['done', 'dismissed']

export function isClosed(status: ItemStatus): boolean {
  return CLOSED_STATUSES.includes(status)
}

export function awaitsSomeoneElse(kind: ItemKind): boolean {
  return AWAITING_OTHERS_KINDS.includes(kind)
}

export function isPassive(kind: ItemKind): boolean {
  return PASSIVE_KINDS.includes(kind)
}

/** Human-facing label for an item kind. Used in UI and spoken briefings. */
export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  task: 'Task',
  commitment: 'Commitment',
  waiting_for: 'Waiting for',
  delegated: 'Delegated',
  follow_up: 'Follow-up',
  someday: 'Someday',
  note: 'Note',
}
