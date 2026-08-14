import { and, eq } from 'drizzle-orm'
import type { BucketContext } from '@/core/domain/items'
import { getDb } from '@/db/client'
import { getItem, transitionItem } from '@/db/repositories/items'
import { auditEvents, items } from '@/db/schema'
import type { ProposedAction } from './schemas'

export interface ActionOutcome {
  ok: boolean
  /** Written for the user. Shown directly in the UI. */
  message: string
}

/**
 * Executes an action the user has approved.
 *
 * Every branch re-reads the target item scoped to `userId` before touching it.
 * That is the point: the model proposed this, and a proposal is untrusted
 * input no matter how it was produced. An id the model hallucinated, or one
 * belonging to someone else, fails here rather than mutating a row.
 */
export async function applyProposedAction(
  userId: string,
  action: ProposedAction,
  ctx: BucketContext,
): Promise<ActionOutcome> {
  switch (action.type) {
    case 'create_item':
      // Creation from chat goes through the normal capture path so that the
      // evidence rules and dedup apply. Handled by the caller, which owns id
      // generation; nothing to do here.
      return { ok: false, message: 'Item creation is handled by the capture flow.' }

    case 'complete_item': {
      const result = await transitionItem(userId, action.itemId, { type: 'complete' }, ctx, 'user')
      return result.ok
        ? { ok: true, message: 'Marked as done.' }
        : { ok: false, message: result.problem ?? 'That could not be completed.' }
    }

    case 'snooze_item': {
      const until = parseIsoDateInZone(action.untilDate, ctx.zone)
      if (!until) {
        return { ok: false, message: 'That snooze date could not be understood.' }
      }
      const result = await transitionItem(
        userId,
        action.itemId,
        { type: 'snooze', until },
        ctx,
        'user',
      )
      return result.ok
        ? { ok: true, message: `Set aside until ${action.untilDate}.` }
        : { ok: false, message: result.problem ?? 'That could not be snoozed.' }
    }

    case 'mute_reminders': {
      const existing = await getItem(userId, action.itemId)
      if (!existing) {
        return { ok: false, message: 'That item could not be found.' }
      }

      const db = await getDb()
      await db
        .update(items)
        .set(
          action.scope === 'forever'
            ? { remindersMuted: true, updatedAt: ctx.now, lastEngagedAt: ctx.now }
            : { remindOnce: true, updatedAt: ctx.now, lastEngagedAt: ctx.now },
        )
        .where(and(eq(items.id, action.itemId), eq(items.userId, userId)))

      await db.insert(auditEvents).values({
        id: `audit_mute_${action.itemId}_${ctx.now.getTime()}`,
        userId,
        action: action.scope === 'forever' ? 'reminders_muted' : 'remind_once_set',
        resourceType: 'item',
        resourceId: action.itemId,
        actor: 'user',
      })

      return {
        ok: true,
        message:
          action.scope === 'forever'
            ? 'I will stop bringing that up.'
            : 'I will mention it once more, then leave it.',
      }
    }
  }
}

/** Parses `YYYY-MM-DD` as end-of-day in the user's zone. */
function parseIsoDateInZone(iso: string, zone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  // Interpreted at 9am local, a reasonable "bring it back" hour rather than
  // midnight, which would surface inside quiet hours.
  const asUtc = new Date(`${iso}T09:00:00Z`)
  if (Number.isNaN(asUtc.getTime())) return null

  // Adjust for the zone offset on that date.
  const offsetMinutes = zoneOffsetMinutes(asUtc, zone)
  return new Date(asUtc.getTime() + offsetMinutes * 60_000)
}

function zoneOffsetMinutes(instant: Date, zone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'shortOffset',
  })
  const part = formatter.formatToParts(instant).find((p) => p.type === 'timeZoneName')
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part?.value ?? '')
  if (!match) return 0
  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2] ?? 0)
  const minutes = Number(match[3] ?? 0)
  return -sign * (hours * 60 + minutes)
}
