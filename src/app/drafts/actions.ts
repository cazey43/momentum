'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { systemClock } from '@/core/time/clock'
import { getDb } from '@/db/client'
import { emailDrafts } from '@/db/schema'
import { approveDraft, sendApprovedDraft } from '@/server/email/drafts'
import { getEmailProvider } from '@/server/email/provider'
import { getSession } from '@/server/session'

/**
 * Draft actions.
 *
 * Approval and sending are deliberately two separate actions with two separate
 * clicks. Collapsing them into one "approve and send" button would mean a
 * single misclick sends mail, and would make the approval record indistinguish-
 * able from the send itself.
 */

export async function approveDraftAction(formData: FormData): Promise<void> {
  const draftId = String(formData.get('draftId') ?? '')
  const seenHash = String(formData.get('contentHash') ?? '')
  if (!draftId || !seenHash) return

  const { userId } = await getSession()
  await approveDraft(userId, draftId, seenHash, systemClock.now())

  revalidatePath('/drafts')
  revalidatePath('/')
}

export async function sendDraftAction(formData: FormData): Promise<void> {
  const draftId = String(formData.get('draftId') ?? '')
  if (!draftId) return

  const { userId } = await getSession()
  const { provider } = await getEmailProvider(userId)

  // Every gate lives inside sendApprovedDraft: approval row, content hash
  // match, not-already-sent, and provider capability.
  await sendApprovedDraft(userId, draftId, provider, systemClock.now())

  revalidatePath('/drafts')
  revalidatePath('/')
}

export async function dismissDraftAction(formData: FormData): Promise<void> {
  const draftId = String(formData.get('draftId') ?? '')
  if (!draftId) return

  const { userId } = await getSession()
  const db = await getDb()

  await db
    .update(emailDrafts)
    .set({ status: 'dismissed', updatedAt: systemClock.now() })
    .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.userId, userId)))

  revalidatePath('/drafts')
  revalidatePath('/')
}

export async function snoozeDraftAction(formData: FormData): Promise<void> {
  const draftId = String(formData.get('draftId') ?? '')
  const days = Number(formData.get('days') ?? 2)
  if (!draftId || !Number.isFinite(days) || days <= 0) return

  const { userId } = await getSession()
  const db = await getDb()
  const now = systemClock.now()

  await db
    .update(emailDrafts)
    .set({
      status: 'snoozed',
      snoozedUntil: new Date(now.getTime() + days * 86_400_000),
      updatedAt: now,
    })
    .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.userId, userId)))

  revalidatePath('/drafts')
  revalidatePath('/')
}
