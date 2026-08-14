import { and, desc, eq, isNull } from 'drizzle-orm'
import type { BucketContext, DomainItem, ItemBucket, ItemTransition } from '@/core/domain/items'
import { applyTransition, bucketOf } from '@/core/domain/items'
import { getDb } from '@/db/client'
import { itemAuditEvents, items, sourceReferences } from '@/db/schema'

type ItemRow = typeof items.$inferSelect

/** Maps a database row into the domain's shape. */
export function toDomainItem(row: ItemRow): DomainItem {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    title: row.title,
    detail: row.detail,
    dueAt: row.dueAt,
    followUpAt: row.followUpAt,
    snoozedUntil: row.snoozedUntil,
    counterpartName: row.counterpartName,
    counterpartEmail: row.counterpartEmail,
    project: row.project,
    origin: row.origin,
    confidence: row.confidence,
    reason: row.reason,
    remindOnce: row.remindOnce,
    remindersMuted: row.remindersMuted,
    nudgeCount: row.nudgeCount,
    lastNudgedAt: row.lastNudgedAt,
    lastEngagedAt: row.lastEngagedAt,
    isDemo: row.isDemo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  }
}

/**
 * Every read is scoped by `userId`.
 *
 * The ownership check is a query predicate, never a post-fetch filter — a
 * row belonging to another user is never loaded into memory in the first
 * place, so it cannot leak through a logging statement or an error message.
 */
export async function listItems(userId: string): Promise<DomainItem[]> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(items)
    .where(and(eq(items.userId, userId), isNull(items.deletedAt)))
    .orderBy(desc(items.updatedAt))
  return rows.map(toDomainItem)
}

export async function getItem(userId: string, itemId: string): Promise<DomainItem | null> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.userId, userId), isNull(items.deletedAt)))
    .limit(1)
  const row = rows[0]
  return row ? toDomainItem(row) : null
}

/** Groups items into the views the UI renders. */
export function groupByBucket(
  list: readonly DomainItem[],
  ctx: BucketContext,
): Record<ItemBucket, DomainItem[]> {
  const grouped: Record<ItemBucket, DomainItem[]> = {
    overdue: [],
    today: [],
    upcoming: [],
    waiting: [],
    inbox: [],
    someday: [],
    snoozed: [],
    completed: [],
  }
  for (const item of list) {
    grouped[bucketOf(item, ctx)].push(item)
  }
  return grouped
}

export class EvidenceRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvidenceRequiredError'
  }
}

export interface CreateItemInput {
  id: string
  userId: string
  kind: DomainItem['kind']
  title: string
  dedupeKey: string
  detail?: string | null
  status?: DomainItem['status']
  priority?: DomainItem['priority']
  dueAt?: Date | null
  followUpAt?: Date | null
  counterpartName?: string | null
  counterpartEmail?: string | null
  project?: string | null
  origin?: DomainItem['origin']
  confidence?: DomainItem['confidence']
  reason?: string | null
  isDemo?: boolean
  /** Source record ids backing this item. Required when origin is 'ai'. */
  sourceRecordIds?: string[]
}

/**
 * Creates an item, enforcing the evidence rule the database cannot express.
 *
 * The schema already guarantees an AI item carries a confidence and a reason.
 * SQLite cannot additionally require "at least one row in source_references",
 * so that half of the rule lives here — and is the only sanctioned way to
 * create an item, which is what makes it binding.
 */
export async function createItem(input: CreateItemInput): Promise<DomainItem> {
  const origin = input.origin ?? 'user'
  const sourceIds = input.sourceRecordIds ?? []

  if (origin === 'ai') {
    if (!input.confidence || !input.reason) {
      throw new EvidenceRequiredError(
        'An AI-created item must carry both a confidence level and a plain-language reason.',
      )
    }
    if (sourceIds.length === 0) {
      throw new EvidenceRequiredError(
        'An AI-created item must cite at least one source, so the user can check it.',
      )
    }
  }

  const db = await getDb()

  await db.insert(items).values({
    id: input.id,
    userId: input.userId,
    kind: input.kind,
    status: input.status ?? 'inbox',
    priority: input.priority ?? 'normal',
    title: input.title,
    detail: input.detail ?? null,
    dueAt: input.dueAt ?? null,
    followUpAt: input.followUpAt ?? null,
    counterpartName: input.counterpartName ?? null,
    counterpartEmail: input.counterpartEmail ?? null,
    project: input.project ?? null,
    origin,
    confidence: input.confidence ?? null,
    reason: input.reason ?? null,
    dedupeKey: input.dedupeKey,
    isDemo: input.isDemo ?? false,
  })

  for (const [index, sourceRecordId] of sourceIds.entries()) {
    await db.insert(sourceReferences).values({
      id: `${input.id}_src_${index}`,
      userId: input.userId,
      sourceRecordId,
      itemId: input.id,
    })
  }

  const created = await getItem(input.userId, input.id)
  if (!created) throw new Error('Item vanished immediately after being created.')
  return created
}

export interface TransitionOutcome {
  ok: boolean
  problem?: string
  item?: DomainItem
}

/**
 * The only sanctioned way to change an item's status.
 *
 * Re-checks ownership server-side rather than trusting the caller, applies the
 * pure transition rules, then writes the row and its audit event together.
 */
export async function transitionItem(
  userId: string,
  itemId: string,
  transition: ItemTransition,
  ctx: BucketContext,
  actor: DomainItem['origin'] = 'user',
): Promise<TransitionOutcome> {
  const current = await getItem(userId, itemId)
  if (!current) {
    return { ok: false, problem: 'That item could not be found.' }
  }

  const result = applyTransition(current, transition, ctx)
  if (!result.ok || !result.changes) {
    return { ok: false, problem: result.problem }
  }

  const db = await getDb()
  const changes = result.changes

  await db
    .update(items)
    .set({
      status: changes.status,
      snoozedUntil: changes.snoozedUntil,
      completedAt: changes.completedAt,
      lastEngagedAt: changes.lastEngagedAt,
      updatedAt: ctx.now,
    })
    .where(and(eq(items.id, itemId), eq(items.userId, userId)))

  await db.insert(itemAuditEvents).values({
    id: `audit_${itemId}_${ctx.now.getTime()}`,
    itemId,
    userId,
    action: result.auditAction ?? transition.type,
    fromValue: current.status,
    toValue: changes.status ?? current.status,
    actor,
  })

  const updated = await getItem(userId, itemId)
  return { ok: true, ...(updated ? { item: updated } : {}) }
}
