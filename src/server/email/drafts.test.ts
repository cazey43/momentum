import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DemoEmailProvider } from '@/adapters/email/demo'
import type { SendCapableEmailProvider } from '@/core/ports/email'
import { db, getDb, sqliteClient } from '@/db/client'
import { emailDrafts, users } from '@/db/schema'
import { approveDraft, computeContentHash, sendApprovedDraft } from './drafts'

const USER = 'user_drafts_test'
const OTHER_USER = 'user_intruder'
const NOW = new Date('2026-08-13T15:00:00Z')

/** A provider that CAN send, so refusals under test are about approval only. */
function makeSendCapableProvider() {
  const sent: unknown[] = []
  const provider: SendCapableEmailProvider = {
    id: 'test-sender',
    isConnected: async () => true,
    grantedScopes: async () => ['Mail.Read', 'Mail.Send'],
    listThreads: async () => [],
    listMessagesInThread: async () => [],
    sendReply: vi.fn(async (input) => {
      sent.push(input)
      return { sentAt: NOW, externalMessageId: 'ext-1' }
    }),
  }
  return { provider, sent }
}

const CONTENT = {
  toRecipients: ['priya@bright.example'],
  ccRecipients: [],
  subject: 'Re: Invoice #4471',
  body: 'Bill it to Q3.',
}

async function insertDraft(id: string, overrides: Record<string, unknown> = {}) {
  const database = await getDb()
  await database.insert(emailDrafts).values({
    id,
    userId: USER,
    threadId: null,
    status: 'drafted',
    toRecipients: CONTENT.toRecipients,
    ccRecipients: CONTENT.ccRecipients,
    subject: CONTENT.subject,
    body: CONTENT.body,
    confidence: 'medium',
    idempotencyKey: `idem-${id}`,
    ...overrides,
  })
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
  await sqliteClient.execute('PRAGMA foreign_keys = ON')
  const database = await getDb()
  await database.insert(users).values([
    { id: USER, displayName: 'Test' },
    { id: OTHER_USER, displayName: 'Intruder' },
  ])
})

beforeEach(async () => {
  const database = await getDb()
  await database.delete(emailDrafts)
})

describe('computeContentHash', () => {
  it('is stable for identical content', () => {
    expect(computeContentHash(CONTENT)).toBe(computeContentHash({ ...CONTENT }))
  })

  it('changes when the body changes', () => {
    expect(computeContentHash({ ...CONTENT, body: 'Bill it to Q4.' })).not.toBe(
      computeContentHash(CONTENT),
    )
  })

  it('changes when a recipient changes', () => {
    // Approving a message to one person must not authorize it to another.
    expect(computeContentHash({ ...CONTENT, toRecipients: ['attacker@example.com'] })).not.toBe(
      computeContentHash(CONTENT),
    )
  })

  it('ignores recipient casing and ordering', () => {
    expect(
      computeContentHash({
        ...CONTENT,
        toRecipients: ['PRIYA@bright.example'],
      }),
    ).toBe(computeContentHash(CONTENT))
  })
})

describe('the send gate', () => {
  it('REFUSES to send a draft that was never approved', async () => {
    await insertDraft('draft_unapproved')
    const { provider, sent } = makeSendCapableProvider()

    const result = await sendApprovedDraft(USER, 'draft_unapproved', provider, NOW)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not_approved')
    expect(sent).toHaveLength(0)
    expect(provider.sendReply).not.toHaveBeenCalled()
  })

  it('sends once the user has approved the exact content', async () => {
    await insertDraft('draft_ok')
    const { provider, sent } = makeSendCapableProvider()

    const approval = await approveDraft(USER, 'draft_ok', computeContentHash(CONTENT), NOW)
    expect(approval.ok).toBe(true)

    const result = await sendApprovedDraft(USER, 'draft_ok', provider, NOW)
    expect(result.ok).toBe(true)
    expect(sent).toHaveLength(1)
  })

  it('REFUSES when the draft changed after approval', async () => {
    // The approve-then-edit-then-send hole. Without the re-hash at send time,
    // this would ship text the user never read.
    await insertDraft('draft_edited')
    const { provider, sent } = makeSendCapableProvider()

    await approveDraft(USER, 'draft_edited', computeContentHash(CONTENT), NOW)

    const database = await getDb()
    await database
      .update(emailDrafts)
      .set({ body: 'Actually, wire the money to a different account.' })
      .where(eq(emailDrafts.id, 'draft_edited'))

    const result = await sendApprovedDraft(USER, 'draft_edited', provider, NOW)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('content_changed_since_approval')
    expect(sent).toHaveLength(0)
  })

  it('REFUSES when the recipient changed after approval', async () => {
    await insertDraft('draft_redirected')
    const { provider, sent } = makeSendCapableProvider()

    await approveDraft(USER, 'draft_redirected', computeContentHash(CONTENT), NOW)

    const database = await getDb()
    await database
      .update(emailDrafts)
      .set({ toRecipients: ['attacker@example.com'] })
      .where(eq(emailDrafts.id, 'draft_redirected'))

    const result = await sendApprovedDraft(USER, 'draft_redirected', provider, NOW)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('content_changed_since_approval')
    expect(sent).toHaveLength(0)
  })

  it('REFUSES on a read-only provider even when approved', async () => {
    await insertDraft('draft_readonly')
    await approveDraft(USER, 'draft_readonly', computeContentHash(CONTENT), NOW)

    const result = await sendApprovedDraft(USER, 'draft_readonly', new DemoEmailProvider(), NOW)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('provider_cannot_send')
  })

  it('REFUSES to send the same draft twice', async () => {
    await insertDraft('draft_twice')
    const { provider, sent } = makeSendCapableProvider()

    await approveDraft(USER, 'draft_twice', computeContentHash(CONTENT), NOW)
    await sendApprovedDraft(USER, 'draft_twice', provider, NOW)
    const second = await sendApprovedDraft(USER, 'draft_twice', provider, NOW)

    expect(second.ok).toBe(false)
    expect(second.reason).toBe('already_sent')
    expect(sent).toHaveLength(1)
  })

  it('REFUSES to send another user’s draft', async () => {
    await insertDraft('draft_owned')
    const { provider, sent } = makeSendCapableProvider()
    await approveDraft(USER, 'draft_owned', computeContentHash(CONTENT), NOW)

    const result = await sendApprovedDraft(OTHER_USER, 'draft_owned', provider, NOW)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not_found')
    expect(sent).toHaveLength(0)
  })

  it('passes the idempotency key through to the provider', async () => {
    await insertDraft('draft_idem')
    const { provider, sent } = makeSendCapableProvider()
    await approveDraft(USER, 'draft_idem', computeContentHash(CONTENT), NOW)
    await sendApprovedDraft(USER, 'draft_idem', provider, NOW)

    expect(sent[0]).toMatchObject({ idempotencyKey: 'idem-draft_idem' })
  })
})

describe('approval', () => {
  it('refuses to approve content different from what was displayed', async () => {
    // Guards the race where a sync rewrites the draft mid-review.
    await insertDraft('draft_stale_view')
    const staleHash = computeContentHash({ ...CONTENT, body: 'An older version.' })

    const result = await approveDraft(USER, 'draft_stale_view', staleHash, NOW)

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/changed while you were reading/i)
  })

  it('refuses to approve another user’s draft', async () => {
    await insertDraft('draft_not_yours')
    const result = await approveDraft(
      OTHER_USER,
      'draft_not_yours',
      computeContentHash(CONTENT),
      NOW,
    )
    expect(result.ok).toBe(false)
  })
})
