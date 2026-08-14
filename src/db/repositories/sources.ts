import { and, eq, inArray } from 'drizzle-orm'
import type { EvidenceSource } from '@/components/Evidence'
import { getDb } from '@/db/client'
import { sourceRecords, sourceReferences } from '@/db/schema'

/**
 * Loads the evidence backing a set of items, keyed by item id.
 *
 * Done as one query rather than per-item so a list of fifty suggestions does
 * not become fifty round trips. Scoped by userId like every other read.
 */
export async function loadSourcesForItems(
  userId: string,
  itemIds: readonly string[],
): Promise<Map<string, EvidenceSource[]>> {
  const result = new Map<string, EvidenceSource[]>()
  if (itemIds.length === 0) return result

  const db = await getDb()
  const rows = await db
    .select({
      itemId: sourceReferences.itemId,
      id: sourceRecords.id,
      title: sourceRecords.title,
      author: sourceRecords.author,
      occurredAt: sourceRecords.occurredAt,
      excerpt: sourceRecords.excerpt,
      externalUrl: sourceRecords.externalUrl,
    })
    .from(sourceReferences)
    .innerJoin(sourceRecords, eq(sourceReferences.sourceRecordId, sourceRecords.id))
    .where(and(eq(sourceReferences.userId, userId), inArray(sourceReferences.itemId, [...itemIds])))

  for (const row of rows) {
    if (!row.itemId) continue
    const list = result.get(row.itemId) ?? []
    list.push({
      id: row.id,
      title: row.title,
      author: row.author,
      occurredAt: row.occurredAt,
      excerpt: row.excerpt,
      externalUrl: row.externalUrl,
    })
    result.set(row.itemId, list)
  }

  return result
}

export async function loadSourcesForDraft(
  userId: string,
  draftId: string,
): Promise<EvidenceSource[]> {
  const db = await getDb()
  const rows = await db
    .select({
      id: sourceRecords.id,
      title: sourceRecords.title,
      author: sourceRecords.author,
      occurredAt: sourceRecords.occurredAt,
      excerpt: sourceRecords.excerpt,
      externalUrl: sourceRecords.externalUrl,
    })
    .from(sourceReferences)
    .innerJoin(sourceRecords, eq(sourceReferences.sourceRecordId, sourceRecords.id))
    .where(and(eq(sourceReferences.userId, userId), eq(sourceReferences.draftId, draftId)))

  return rows
}
