import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { canSend, type EmailProvider } from '@/core/ports/email'
import { getDb } from '@/db/client'
import { auditEvents, draftApprovals, emailDrafts } from '@/db/schema'

/**
 * Draft approval and sending.
 *
 * The rule the spec cares most about: nothing is sent without explicit
 * approval. That is implemented as three separate conditions, all of which
 * must hold at send time:
 *
 *   1. A `draft_approvals` row exists for this draft. Approval is a recorded
 *      human act, not a boolean someone could flip.
 *   2. The approval's content hash matches the draft's *current* content. If
 *      the body changed after approval — by any path — the approval no longer
 *      applies and the send is refused.
 *   3. The provider actually implements sending. A read-only account cannot
 *      send even if the first two hold.
 *
 * Condition 2 is the one that is easy to miss. Without it, "approve, then
 * edit, then send" would ship text the user never saw.
 */

export interface DraftContent {
  toRecipients: string[]
  ccRecipients: string[]
  subject: string
  body: string
}

/**
 * Hashes exactly what the user is shown on the approval screen.
 *
 * Recipients are included: approving a message to Dana must not authorize the
 * same text to a different address.
 */
export function computeContentHash(content: DraftContent): string {
  const canonical = JSON.stringify({
    to: [...content.toRecipients].map((s) => s.trim().toLowerCase()).sort(),
    cc: [...content.ccRecipients].map((s) => s.trim().toLowerCase()).sort(),
    subject: content.subject.trim(),
    body: content.body.trim(),
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export type SendRefusalReason =
  | 'not_found'
  | 'not_approved'
  | 'content_changed_since_approval'
  | 'already_sent'
  | 'provider_cannot_send'
  | 'no_recipients'

export interface SendResult {
  ok: boolean
  reason?: SendRefusalReason
  /** Written for the user. */
  message: string
}

const REFUSAL_COPY: Record<SendRefusalReason, string> = {
  not_found: 'That draft could not be found.',
  not_approved: 'This has not been approved yet, so nothing was sent.',
  content_changed_since_approval:
    'The draft changed after you approved it, so it was not sent. Review the new version and approve again.',
  already_sent: 'This was already sent. Nothing was sent a second time.',
  provider_cannot_send:
    'This account is connected with read-only access, so Momentum cannot send from it. Nothing was sent.',
  no_recipients: 'This draft has no recipients, so nothing was sent.',
}

/**
 * Records the user's approval of the exact content they were shown.
 *
 * `seenContentHash` comes from the approval screen. If the draft changed
 * between render and click, the hashes disagree and the approval is refused —
 * this closes the race where a background sync rewrites a draft mid-review.
 */
export async function approveDraft(
  userId: string,
  draftId: string,
  seenContentHash: string,
  now: Date,
): Promise<{ ok: boolean; message: string }> {
  const db = await getDb()

  const rows = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.userId, userId)))
    .limit(1)

  const draft = rows[0]
  if (!draft) return { ok: false, message: REFUSAL_COPY.not_found }
  if (draft.status === 'sent') return { ok: false, message: REFUSAL_COPY.already_sent }

  const currentHash = computeContentHash({
    toRecipients: draft.toRecipients,
    ccRecipients: draft.ccRecipients,
    subject: draft.subject,
    body: draft.body,
  })

  if (currentHash !== seenContentHash) {
    return {
      ok: false,
      message: 'This draft changed while you were reading it. Take another look before approving.',
    }
  }

  await db
    .insert(draftApprovals)
    .values({
      id: `approval_${draftId}`,
      draftId,
      userId,
      approvedContentHash: currentHash,
      approvedAt: now,
    })
    .onConflictDoUpdate({
      target: draftApprovals.draftId,
      set: { approvedContentHash: currentHash, approvedAt: now },
    })

  await db
    .update(emailDrafts)
    .set({ status: 'approved', updatedAt: now })
    .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.userId, userId)))

  await db.insert(auditEvents).values({
    id: `audit_approve_${draftId}_${now.getTime()}`,
    userId,
    action: 'draft_approved',
    resourceType: 'email_draft',
    resourceId: draftId,
    actor: 'user',
    // Metadata records the hash, never the message body.
    metadata: { contentHash: currentHash },
  })

  return { ok: true, message: 'Approved. It will not send until you choose to send it.' }
}

/**
 * Sends a draft, refusing unless every approval condition holds.
 *
 * Note this function never *derives* approval from state like "status is
 * approved" alone — it re-reads the approval row and re-hashes the current
 * content. Status is a convenience for the UI; the approval row is the truth.
 */
export async function sendApprovedDraft(
  userId: string,
  draftId: string,
  provider: EmailProvider,
  now: Date,
): Promise<SendResult> {
  const db = await getDb()

  const rows = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.userId, userId)))
    .limit(1)

  const draft = rows[0]
  if (!draft) return refuse('not_found')
  if (draft.status === 'sent' || draft.sentAt) return refuse('already_sent')
  if (draft.toRecipients.length === 0) return refuse('no_recipients')

  const approvals = await db
    .select()
    .from(draftApprovals)
    .where(and(eq(draftApprovals.draftId, draftId), eq(draftApprovals.userId, userId)))
    .limit(1)

  const approval = approvals[0]
  if (!approval) return refuse('not_approved')

  const currentHash = computeContentHash({
    toRecipients: draft.toRecipients,
    ccRecipients: draft.ccRecipients,
    subject: draft.subject,
    body: draft.body,
  })

  if (currentHash !== approval.approvedContentHash) {
    return refuse('content_changed_since_approval')
  }

  if (!canSend(provider)) return refuse('provider_cannot_send')

  const sent = await provider.sendReply({
    externalThreadId: draft.threadId ?? '',
    to: draft.toRecipients,
    cc: draft.ccRecipients,
    subject: draft.subject,
    body: draft.body,
    idempotencyKey: draft.idempotencyKey,
  })

  await db
    .update(emailDrafts)
    .set({ status: 'sent', sentAt: sent.sentAt, updatedAt: now })
    .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.userId, userId)))

  await db.insert(auditEvents).values({
    id: `audit_send_${draftId}_${now.getTime()}`,
    userId,
    action: 'email_sent',
    resourceType: 'email_draft',
    resourceId: draftId,
    actor: 'user',
    metadata: {
      recipientCount: draft.toRecipients.length,
      externalMessageId: sent.externalMessageId,
    },
  })

  return { ok: true, message: 'Sent.' }
}

function refuse(reason: SendRefusalReason): SendResult {
  return { ok: false, reason, message: REFUSAL_COPY[reason] }
}
