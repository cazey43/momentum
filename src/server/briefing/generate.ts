import { and, eq } from 'drizzle-orm'
import type { BucketContext, DomainItem } from '@/core/domain/items'
import { bucketOf, daysOverdue, daysWaiting } from '@/core/domain/items'
import { ITEM_KIND_LABELS } from '@/core/domain/vocabulary'
import { topPriorities } from '@/core/priority/rank'
import { localDateString } from '@/core/time/clock'
import { getDb } from '@/db/client'
import { listItems } from '@/db/repositories/items'
import { dailyBriefings, encouragements } from '@/db/schema'
import { briefingPrompt } from '@/prompts/briefing'
import { promptLabel } from '@/prompts/types'
import { getModelProvider } from '@/server/ai/gateway'
import { type Briefing, briefingSchema } from '@/server/ai/schemas'
import type { UntrustedBlock } from '@/server/ai/untrusted'

export interface BriefingView {
  localDate: string
  short: string
  expanded: string | null
  suggestedOrder: string[]
  encouragement: { body: string; attribution: string | null } | null
  isDeterministic: boolean
}

function describeForBriefing(item: DomainItem, ctx: BucketContext): string {
  const bucket = bucketOf(item, ctx)
  const overdue = daysOverdue(item, ctx)
  const waiting = daysWaiting(item, ctx)

  const parts = [`${item.id} [${ITEM_KIND_LABELS[item.kind]}/${bucket}]`]
  if (overdue > 0) parts.push(`overdue:${overdue}d`)
  if (waiting > 0) parts.push(`waiting:${waiting}d`)
  if (item.counterpartName) parts.push(`with:${item.counterpartName}`)
  if (item.origin === 'ai') parts.push(`inferred:${item.confidence ?? 'unknown'}`)
  parts.push(`— ${item.title}`)
  return parts.join(' ')
}

/**
 * Reads today's briefing if one exists, otherwise generates and stores it.
 *
 * The uniqueness constraint on (user, local date) is what enforces "no more
 * than one proactive daily briefing" — the limit is a property of the schema,
 * not a counter someone could forget to increment.
 */
export async function getOrCreateTodaysBriefing(
  userId: string,
  ctx: BucketContext,
): Promise<BriefingView | null> {
  const db = await getDb()
  const localDate = localDateString(ctx.now, ctx.zone)

  const existing = await db
    .select()
    .from(dailyBriefings)
    .where(and(eq(dailyBriefings.userId, userId), eq(dailyBriefings.localDate, localDate)))
    .limit(1)

  const found = existing[0]
  if (found) {
    const encouragement = await db
      .select()
      .from(encouragements)
      .where(and(eq(encouragements.userId, userId), eq(encouragements.localDate, localDate)))
      .limit(1)

    const line = encouragement[0]
    return {
      localDate,
      short: found.shortBody,
      expanded: found.expandedBody,
      suggestedOrder: found.suggestedOrder,
      encouragement: line ? { body: line.body, attribution: line.attribution } : null,
      isDeterministic: found.modelId === 'deterministic',
    }
  }

  return generateBriefing(userId, ctx)
}

export async function generateBriefing(
  userId: string,
  ctx: BucketContext,
): Promise<BriefingView | null> {
  const db = await getDb()
  const localDate = localDateString(ctx.now, ctx.zone)
  const provider = getModelProvider()

  const all = await listItems(userId)
  const relevant = all.filter((item) => {
    const bucket = bucketOf(item, ctx)
    return bucket === 'overdue' || bucket === 'today' || bucket === 'waiting' || bucket === 'inbox'
  })

  if (relevant.length === 0) {
    // Nothing to brief on. Say that honestly rather than generating filler.
    return {
      localDate,
      short: 'Nothing urgent is hiding right now. You can focus on the work you chose.',
      expanded: null,
      suggestedOrder: [],
      encouragement: null,
      isDeterministic: true,
    }
  }

  const context: UntrustedBlock[] = [
    {
      label: "the user's open items",
      content: relevant.map((item) => describeForBriefing(item, ctx)).join('\n'),
    },
  ]

  const ranked = topPriorities(all, ctx)

  const input = [
    `Today is ${localDate} (${ctx.zone}).`,
    '',
    'Deterministic ranking already computed, for your reference:',
    ...ranked.map((r) => `- ${r.item.id}: ${r.reason}`),
    '',
    'Write the briefing.',
  ].join('\n')

  let result: Briefing | null = null
  let isDeterministic = true
  let modelId = provider.id

  try {
    const response = await provider.generateStructured({
      promptId: briefingPrompt.id,
      promptVersion: briefingPrompt.version,
      system: briefingPrompt.system,
      input,
      untrusted: context,
      schema: briefingSchema,
    })
    result = response.data
    isDeterministic = response.isDeterministic
    modelId = response.modelId
  } catch {
    return null
  }

  if (!result) return null

  await db.insert(dailyBriefings).values({
    id: `briefing_${userId}_${localDate}`,
    userId,
    localDate,
    shortBody: result.short,
    expandedBody: result.expanded,
    suggestedOrder: result.suggestedOrder,
    promptVersion: promptLabel(briefingPrompt),
    modelId,
    deliveredAt: ctx.now,
  })

  // The schema forbids an attribution on an original line; enforce it here too
  // so a model slip is corrected rather than rejected outright.
  if (result.encouragement) {
    const attribution =
      result.encouragement.kind === 'original' ? null : result.encouragement.attribution
    await db
      .insert(encouragements)
      .values({
        id: `enc_${userId}_${localDate}`,
        userId,
        body: result.encouragement.body,
        attribution,
        kind: result.encouragement.kind,
        localDate,
      })
      .onConflictDoNothing()
  }

  return {
    localDate,
    short: result.short,
    expanded: result.expanded,
    suggestedOrder: result.suggestedOrder,
    encouragement: result.encouragement
      ? {
          body: result.encouragement.body,
          attribution:
            result.encouragement.kind === 'original' ? null : result.encouragement.attribution,
        }
      : null,
    isDeterministic,
  }
}
