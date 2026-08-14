import { eq } from 'drizzle-orm'
import { DEMO_USER_ID, DEMO_USER_NAME } from '@/config/demo'
import { computeDedupeKey } from '@/core/domain/items'
import { DAY_MS, HOUR_MS, localDateString, systemClock } from '@/core/time/clock'
import { getDb, sqliteClient } from './client'
import {
  dailyBriefings,
  emailDrafts,
  emailThreadSummaries,
  emailThreads,
  items,
  sourceRecords,
  sourceReferences,
  userPreferences,
  users,
} from './schema'

/**
 * Seeds a realistic demo dataset.
 *
 * Everything here exists to exercise the full review flow without credentials
 * and without sending anything: a genuinely overdue commitment, a person who
 * has gone quiet, a possible loose end with real evidence attached, a reply
 * waiting on approval, and a briefing that reads like a briefing.
 *
 * Dates are relative to the current time so the demo never goes stale.
 */

const ZONE = 'America/Detroit'
const now = systemClock.now()

function at(offsetMs: number): Date {
  return new Date(now.getTime() + offsetMs)
}

async function wipeExistingDemoData() {
  const db = await getDb()
  // Ordered by dependency; foreign keys cascade, but being explicit keeps this
  // readable and safe if the schema changes.
  await db.delete(sourceReferences).where(eq(sourceReferences.userId, DEMO_USER_ID))
  await db.delete(emailDrafts).where(eq(emailDrafts.userId, DEMO_USER_ID))
  await db.delete(emailThreadSummaries).where(eq(emailThreadSummaries.userId, DEMO_USER_ID))
  await db.delete(emailThreads).where(eq(emailThreads.userId, DEMO_USER_ID))
  await db.delete(dailyBriefings).where(eq(dailyBriefings.userId, DEMO_USER_ID))
  await db.delete(items).where(eq(items.userId, DEMO_USER_ID))
  await db.delete(sourceRecords).where(eq(sourceRecords.userId, DEMO_USER_ID))
  await db.delete(userPreferences).where(eq(userPreferences.userId, DEMO_USER_ID))
  await db.delete(users).where(eq(users.id, DEMO_USER_ID))
}

async function seed() {
  await sqliteClient.execute('PRAGMA foreign_keys = ON')
  const db = await getDb()

  console.log('Clearing any existing demo data…')
  await wipeExistingDemoData()

  console.log('Seeding demo user…')
  await db.insert(users).values({
    id: DEMO_USER_ID,
    displayName: DEMO_USER_NAME,
    email: 'demo@example.com',
  })
  await db.insert(userPreferences).values({ userId: DEMO_USER_ID, timezone: ZONE })

  // -------------------------------------------------------------------------
  // Source records — the evidence every inference points back to
  // -------------------------------------------------------------------------
  console.log('Seeding source records…')

  const sources = [
    {
      id: 'src_demo_contract',
      kind: 'email' as const,
      title: 'Re: Northwind renewal paperwork',
      // Authored by the user, not by Dana: the item's reason says "You wrote…",
      // so the evidence has to be the user's own message or the card would
      // contradict itself. This matches the demo mailbox adapter, where the
      // same message is `fromMe: true`.
      author: `${DEMO_USER_NAME} <demo@example.com>`,
      occurredAt: at(-6 * DAY_MS),
      excerpt: "Thanks Dana — I'll send the signed contract over by Friday so legal can review.",
      externalUrl: 'https://outlook.office.com/mail/demo/contract',
    },
    {
      id: 'src_demo_invoice',
      kind: 'email' as const,
      title: 'Invoice #4471 — payment question',
      author: 'Priya Raman <priya@bright.example>',
      occurredAt: at(-4 * DAY_MS),
      excerpt: 'Could you confirm whether this should be billed to the Q3 or Q4 budget?',
      externalUrl: 'https://outlook.office.com/mail/demo/invoice',
    },
    {
      id: 'src_demo_intro',
      kind: 'email' as const,
      title: 'Intro: Sam Okafor <> you',
      author: 'Marcus Lee <marcus@example.org>',
      occurredAt: at(-9 * DAY_MS),
      excerpt: "Happy to make the intro. Sam's expecting to hear from you this week.",
      externalUrl: 'https://outlook.office.com/mail/demo/intro',
    },
    {
      id: 'src_demo_standup',
      kind: 'note' as const,
      title: 'Monday planning notes',
      author: DEMO_USER_NAME,
      occurredAt: at(-11 * DAY_MS),
      excerpt: 'Need to book the venue for the November offsite before prices go up.',
      externalUrl: null,
    },
  ]

  for (const source of sources) {
    await db.insert(sourceRecords).values({
      id: source.id,
      userId: DEMO_USER_ID,
      kind: source.kind,
      externalId: source.id,
      externalUrl: source.externalUrl,
      title: source.title,
      author: source.author,
      occurredAt: source.occurredAt,
      excerpt: source.excerpt,
      isDemo: true,
    })
  }

  // -------------------------------------------------------------------------
  // Items — one per situation the product claims to handle
  // -------------------------------------------------------------------------
  console.log('Seeding items…')

  const demoItems = [
    // An overdue commitment the user made in writing. High confidence: the
    // evidence is an unambiguous first-person promise with a date.
    {
      id: 'item_demo_contract',
      kind: 'commitment' as const,
      status: 'open' as const,
      priority: 'high' as const,
      title: 'Send the signed Northwind contract to Dana',
      detail: 'Legal needs it before they can start review.',
      dueAt: at(-2 * DAY_MS),
      counterpartName: 'Dana Whitfield',
      counterpartEmail: 'dana@northwind.example',
      project: 'Northwind renewal',
      origin: 'ai' as const,
      confidence: 'high' as const,
      reason: 'You wrote "I\'ll send the signed contract over by Friday" on 7 Aug.',
      sourceRecordIds: ['src_demo_contract'],
    },
    // Due today, recorded by the user — no confidence needed.
    {
      id: 'item_demo_slides',
      kind: 'task' as const,
      status: 'in_progress' as const,
      priority: 'normal' as const,
      title: 'Finish the Q3 board slides',
      detail: 'Sections 1–4 done. Financials still need the updated forecast.',
      dueAt: at(6 * HOUR_MS),
      project: 'Board meeting',
      origin: 'user' as const,
      sourceRecordIds: [],
    },
    // Waiting on someone else. Belongs in Waiting For, never in Overdue.
    {
      id: 'item_demo_waiting_priya',
      kind: 'waiting_for' as const,
      status: 'open' as const,
      priority: 'normal' as const,
      title: 'Priya to confirm the billing period for invoice #4471',
      followUpAt: at(-4 * DAY_MS),
      counterpartName: 'Priya Raman',
      counterpartEmail: 'priya@bright.example',
      origin: 'ai' as const,
      confidence: 'high' as const,
      reason: 'Priya asked a direct question on 9 Aug and the thread has had no reply since.',
      sourceRecordIds: ['src_demo_invoice'],
    },
    // A delegated item with no recorded outcome — a classic silent failure.
    {
      id: 'item_demo_delegated',
      kind: 'delegated' as const,
      status: 'open' as const,
      priority: 'normal' as const,
      title: 'Jordan to update the onboarding checklist',
      followUpAt: at(-8 * DAY_MS),
      counterpartName: 'Jordan Ellis',
      origin: 'user' as const,
      sourceRecordIds: [],
    },
    // A low-confidence loose end. Deliberately hedged: the evidence is weaker,
    // so the reason says so and the item ranks lower than the facts above.
    {
      id: 'item_demo_loose_intro',
      kind: 'follow_up' as const,
      status: 'inbox' as const,
      priority: 'normal' as const,
      title: 'Possibly owed: reply to Sam Okafor after the intro',
      detail: 'Marcus made the introduction and said Sam was expecting to hear from you.',
      followUpAt: at(-9 * DAY_MS),
      counterpartName: 'Sam Okafor',
      origin: 'ai' as const,
      confidence: 'low' as const,
      reason:
        'An introduction was made on 4 Aug and no reply from you appears in the thread. You may have replied elsewhere.',
      sourceRecordIds: ['src_demo_intro'],
    },
    // Upcoming, no pressure yet.
    {
      id: 'item_demo_offsite',
      kind: 'task' as const,
      status: 'open' as const,
      priority: 'normal' as const,
      title: 'Book the venue for the November offsite',
      dueAt: at(9 * DAY_MS),
      origin: 'ai' as const,
      confidence: 'medium' as const,
      reason: 'Your planning note on 2 Aug said this needed doing before prices rise.',
      sourceRecordIds: ['src_demo_standup'],
    },
    // Snoozed — proves suppression is real and visible.
    {
      id: 'item_demo_snoozed',
      kind: 'task' as const,
      status: 'snoozed' as const,
      priority: 'low' as const,
      title: 'Review the new expense policy',
      dueAt: at(-1 * DAY_MS),
      snoozedUntil: at(3 * DAY_MS),
      origin: 'user' as const,
      sourceRecordIds: [],
    },
    // Someday — must never appear in Today.
    {
      id: 'item_demo_someday',
      kind: 'someday' as const,
      status: 'open' as const,
      priority: 'low' as const,
      title: 'Look into a proper CRM for the consulting side',
      origin: 'user' as const,
      sourceRecordIds: [],
    },
    // Completed, so the Completed view is not empty on first run.
    {
      id: 'item_demo_done',
      kind: 'task' as const,
      status: 'done' as const,
      priority: 'normal' as const,
      title: 'Approve the September hiring plan',
      dueAt: at(-3 * DAY_MS),
      origin: 'user' as const,
      sourceRecordIds: [],
    },
  ]

  for (const item of demoItems) {
    await db.insert(items).values({
      id: item.id,
      userId: DEMO_USER_ID,
      kind: item.kind,
      status: item.status,
      priority: item.priority,
      title: item.title,
      detail: 'detail' in item ? (item.detail ?? null) : null,
      dueAt: 'dueAt' in item ? (item.dueAt ?? null) : null,
      followUpAt: 'followUpAt' in item ? (item.followUpAt ?? null) : null,
      snoozedUntil: 'snoozedUntil' in item ? (item.snoozedUntil ?? null) : null,
      counterpartName: 'counterpartName' in item ? (item.counterpartName ?? null) : null,
      counterpartEmail: 'counterpartEmail' in item ? (item.counterpartEmail ?? null) : null,
      project: 'project' in item ? (item.project ?? null) : null,
      origin: item.origin,
      confidence: 'confidence' in item ? (item.confidence ?? null) : null,
      reason: 'reason' in item ? (item.reason ?? null) : null,
      completedAt: item.status === 'done' ? at(-3 * DAY_MS) : null,
      dedupeKey: computeDedupeKey({
        kind: item.kind,
        title: item.title,
        counterpartEmail: 'counterpartEmail' in item ? item.counterpartEmail : null,
        dueAt: 'dueAt' in item ? (item.dueAt ?? null) : null,
        zone: ZONE,
      }),
      isDemo: true,
    })

    for (const [index, sourceRecordId] of item.sourceRecordIds.entries()) {
      await db.insert(sourceReferences).values({
        id: `${item.id}_src_${index}`,
        userId: DEMO_USER_ID,
        sourceRecordId,
        itemId: item.id,
        relevance: 'Supports the detection of this item.',
      })
    }
  }

  // -------------------------------------------------------------------------
  // Email threads, a summary, and a draft awaiting approval
  // -------------------------------------------------------------------------
  console.log('Seeding email threads and a draft…')

  await db.insert(emailThreads).values([
    {
      id: 'thread_demo_invoice',
      userId: DEMO_USER_ID,
      externalThreadId: 'AAQkAD-demo-invoice',
      subject: 'Invoice #4471 — payment question',
      participants: ['priya@bright.example', 'demo@example.com'],
      lastMessageAt: at(-4 * DAY_MS),
      lastMessageFromMe: false,
      unread: true,
      category: 'primary',
      sensitivity: 'sensitive', // financial content — flagged for careful review
      isDemo: true,
    },
    {
      id: 'thread_demo_contract',
      userId: DEMO_USER_ID,
      externalThreadId: 'AAQkAD-demo-contract',
      subject: 'Re: Northwind renewal paperwork',
      participants: ['dana@northwind.example', 'demo@example.com'],
      lastMessageAt: at(-6 * DAY_MS),
      lastMessageFromMe: true,
      unread: false,
      category: 'primary',
      sensitivity: 'normal',
      isDemo: true,
    },
    {
      id: 'thread_demo_newsletter',
      userId: DEMO_USER_ID,
      externalThreadId: 'AAQkAD-demo-newsletter',
      subject: 'The Weekly Ops Digest — issue 212',
      participants: ['digest@ops.example'],
      lastMessageAt: at(-1 * DAY_MS),
      lastMessageFromMe: false,
      unread: true,
      category: 'newsletter', // grouped away from real mail
      sensitivity: 'normal',
      isDemo: true,
    },
  ])

  await db.insert(emailThreadSummaries).values({
    id: 'summary_demo_invoice',
    threadId: 'thread_demo_invoice',
    userId: DEMO_USER_ID,
    summary:
      'Priya is asking which budget period invoice #4471 should be billed against. She needs an answer before month end.',
    needsReply: true,
    confidence: 'high',
    promptVersion: 'demo-seed',
    modelId: 'demo',
  })

  await db.insert(emailDrafts).values({
    id: 'draft_demo_invoice',
    userId: DEMO_USER_ID,
    threadId: 'thread_demo_invoice',
    status: 'drafted',
    toRecipients: ['priya@bright.example'],
    ccRecipients: [],
    subject: 'Re: Invoice #4471 — payment question',
    body: [
      'Hi Priya,',
      '',
      'Thanks for flagging this, and sorry for the slow reply.',
      '',
      "Invoice #4471 should be billed against Q3. I've asked our finance team to confirm on their side, and I'll let you know if anything changes.",
      '',
      'Best,',
      DEMO_USER_NAME,
    ].join('\n'),
    confidence: 'medium',
    // Financial content: the UI must ask the user to read this one carefully.
    requiresCarefulReview: true,
    idempotencyKey: 'demo-draft-invoice-0001',
    promptVersion: 'demo-seed',
    modelId: 'demo',
    isDemo: true,
  })

  await db.insert(sourceReferences).values({
    id: 'draft_demo_invoice_src',
    userId: DEMO_USER_ID,
    sourceRecordId: 'src_demo_invoice',
    draftId: 'draft_demo_invoice',
    relevance: 'The question this reply answers.',
  })

  // -------------------------------------------------------------------------
  // A daily briefing
  // -------------------------------------------------------------------------
  console.log('Seeding a daily briefing…')

  await db.insert(dailyBriefings).values({
    id: 'briefing_demo_today',
    userId: DEMO_USER_ID,
    localDate: localDateString(now, ZONE),
    shortBody: [
      'Two things need you today.',
      '',
      'The Northwind contract you promised Dana is two days past the date you gave her — that one is worth clearing first. The board slides are due this afternoon and are already underway.',
      '',
      "Priya has been waiting four days on a billing question; there's a reply drafted for your approval.",
    ].join('\n'),
    expandedBody: [
      'Overdue',
      '· Send the signed Northwind contract to Dana (promised by 7 Aug)',
      '',
      'Due today',
      '· Finish the Q3 board slides — in progress',
      '',
      'Waiting on others',
      '· Priya Raman — billing period for invoice #4471 (4 days)',
      '· Jordan Ellis — onboarding checklist update (8 days)',
      '',
      'Possibly slipped',
      '· A reply to Sam Okafor after the intro from Marcus. Low confidence — you may have replied elsewhere.',
    ].join('\n'),
    suggestedOrder: ['item_demo_contract', 'item_demo_slides', 'draft_demo_invoice'],
    promptVersion: 'demo-seed',
    modelId: 'demo',
  })

  console.log('\nDemo data seeded. All rows are marked isDemo = true.')
}

seed()
  .then(() => {
    sqliteClient.close()
    process.exit(0)
  })
  .catch((error) => {
    console.error('Seed failed:', error)
    sqliteClient.close()
    process.exit(1)
  })
