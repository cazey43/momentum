import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/*
 * Momentum data model
 * ===================
 *
 * Conventions applied throughout:
 *
 * - Every owned row carries `userId`. Even though this release is single-user,
 *   the column exists so the ownership check is a real query predicate rather
 *   than an assumption, and so a multi-user port does not require a migration
 *   of every table.
 * - Timestamps are epoch milliseconds (`timestamp_ms`), always UTC. Local time
 *   is a presentation concern resolved against the user's IANA zone.
 * - Soft deletion (`deletedAt`) is used where history matters — items, drafts,
 *   source records. Rows that are pure telemetry are hard-deleted by retention.
 * - Text columns that hold a fixed vocabulary use `$type<>()` so the union is
 *   enforced by the compiler, plus a CHECK constraint so it is enforced by the
 *   database. Both, because the model layer writes here too.
 */

// ---------------------------------------------------------------------------
// Shared vocabularies
//
// Defined in the domain layer (src/core/domain/vocabulary.ts), which has no
// dependencies at all, and imported here. The database describes the domain;
// it does not define it. Re-exported so callers already importing from the
// schema keep working.
// ---------------------------------------------------------------------------

import type {
  ConfidenceLevel,
  DraftStatus,
  ItemKind,
  ItemStatus,
  Origin,
  Priority,
  ReminderLevel,
  SourceKind,
} from '@/core/domain/vocabulary'
import {
  CONFIDENCE_LEVELS,
  DRAFT_STATUSES,
  ITEM_KINDS,
  ITEM_STATUSES,
  ORIGINS,
  PRIORITIES,
  REMINDER_LEVELS,
  SOURCE_KINDS,
} from '@/core/domain/vocabulary'

export * from '@/core/domain/vocabulary'

function oneOf(column: string, values: readonly string[]): string {
  return `${column} in (${values.map((v) => `'${v}'`).join(', ')})`
}

const now = sql`(unixepoch() * 1000)`

// ---------------------------------------------------------------------------
// Identity and preferences
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  email: text('email'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
})

/**
 * One row per user. Every field here is user-editable in Settings — nothing in
 * this table may be hardcoded elsewhere in the app.
 */
export const userPreferences = sqliteTable(
  'user_preferences',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    timezone: text('timezone').notNull().default('America/Detroit'),

    // Stored as "HH:MM" local wall-clock, not instants — quiet hours must mean
    // 8pm local regardless of DST.
    briefingTime: text('briefing_time').notNull().default('08:00'),
    quietHoursStart: text('quiet_hours_start').notNull().default('20:00'),
    quietHoursEnd: text('quiet_hours_end').notNull().default('08:00'),

    dailyNudgeBudget: integer('daily_nudge_budget').notNull().default(2),
    briefingsPerDay: integer('briefings_per_day').notNull().default(1),
    reminderIntensity: text('reminder_intensity')
      .$type<ReminderLevel>()
      .notNull()
      .default('gentle'),

    /** Global kill switch required by the spec. */
    proactiveRemindersPaused: integer('proactive_reminders_paused', { mode: 'boolean' })
      .notNull()
      .default(false),

    quotesEnabled: integer('quotes_enabled', { mode: 'boolean' }).notNull().default(true),
    maxQuotesPerDay: integer('max_quotes_per_day').notNull().default(1),

    /** Weekends: suppress the briefing, keep reminders silent. */
    weekendBriefings: integer('weekend_briefings', { mode: 'boolean' }).notNull().default(false),
    weekendReminders: integer('weekend_reminders', { mode: 'boolean' }).notNull().default(false),

    /** Voice is opt-in; hands-free is opt-in on top of that. */
    voiceEnabled: integer('voice_enabled', { mode: 'boolean' }).notNull().default(true),
    handsFreeEnabled: integer('hands_free_enabled', { mode: 'boolean' }).notNull().default(false),
    storeAudio: integer('store_audio', { mode: 'boolean' }).notNull().default(false),

    /** Tone used when drafting replies on the user's behalf. */
    draftingTone: text('drafting_tone').notNull().default('warm, direct, concise'),

    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [
    check('prefs_intensity_valid', sql.raw(oneOf('reminder_intensity', REMINDER_LEVELS))),
    check(
      'prefs_nudge_budget_sane',
      sql`${t.dailyNudgeBudget} >= 0 and ${t.dailyNudgeBudget} <= 10`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Connected accounts
// ---------------------------------------------------------------------------

export const connectedAccounts = sqliteTable(
  'connected_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    provider: text('provider').$type<'microsoft' | 'google' | 'demo'>().notNull(),
    accountLabel: text('account_label').notNull(),

    /**
     * Tokens are AES-256-GCM ciphertext, never plaintext. The encryption key
     * lives in the environment and never in this database.
     */
    accessTokenEncrypted: text('access_token_encrypted'),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp_ms' }),

    /** Exactly what the user granted, so the UI can show it back to them. */
    grantedScopes: text('granted_scopes', { mode: 'json' }).$type<string[]>().notNull(),

    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
    lastSyncError: text('last_sync_error'),

    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('connected_accounts_user_idx').on(t.userId),
    uniqueIndex('connected_accounts_user_provider_label_idx').on(
      t.userId,
      t.provider,
      t.accountLabel,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Source records — provenance for everything the assistant infers
// ---------------------------------------------------------------------------

/**
 * A normalized pointer to the thing an inference came from.
 *
 * `excerpt` deliberately stores a short span rather than full message bodies:
 * the spec requires storing no more content than the feature needs. The offsets
 * let the UI show the quote in context without keeping the whole message.
 */
export const sourceRecords = sqliteTable(
  'source_records',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    kind: text('kind').$type<SourceKind>().notNull(),

    /** Stable id in the origin system (Graph message id, thread id, etc.). */
    externalId: text('external_id'),
    /** Deep link back to the original, shown as "view source". */
    externalUrl: text('external_url'),

    title: text('title'),
    author: text('author'),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }),

    excerpt: text('excerpt'),
    excerptStart: integer('excerpt_start'),
    excerptEnd: integer('excerpt_end'),

    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),

    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('source_records_user_kind_idx').on(t.userId, t.kind),
    uniqueIndex('source_records_user_external_idx').on(t.userId, t.kind, t.externalId),
    check('source_records_kind_valid', sql.raw(oneOf('kind', SOURCE_KINDS))),
  ],
)

// ---------------------------------------------------------------------------
// Items — the unified actionable record
// ---------------------------------------------------------------------------

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    kind: text('kind').$type<ItemKind>().notNull(),
    status: text('status').$type<ItemStatus>().notNull().default('inbox'),
    priority: text('priority').$type<Priority>().notNull().default('normal'),

    title: text('title').notNull(),
    detail: text('detail'),

    dueAt: integer('due_at', { mode: 'timestamp_ms' }),
    followUpAt: integer('follow_up_at', { mode: 'timestamp_ms' }),
    snoozedUntil: integer('snoozed_until', { mode: 'timestamp_ms' }),

    /** Who the item involves — the person we are waiting on, or delegated to. */
    counterpartName: text('counterpart_name'),
    counterpartEmail: text('counterpart_email'),

    project: text('project'),

    origin: text('origin').$type<Origin>().notNull().default('user'),
    /**
     * Non-null whenever origin = 'ai'. Enforced by CHECK below: the app must
     * not be able to present a machine guess without saying how sure it is.
     */
    confidence: text('confidence').$type<ConfidenceLevel>(),
    /** Plain-language reason this was surfaced, shown verbatim in the UI. */
    reason: text('reason'),

    reminderLevel: text('reminder_level').$type<ReminderLevel>().notNull().default('gentle'),
    /** Honors "only remind me once". */
    remindOnce: integer('remind_once', { mode: 'boolean' }).notNull().default(false),
    /** Honors "stop reminding me about this". */
    remindersMuted: integer('reminders_muted', { mode: 'boolean' }).notNull().default(false),
    nudgeCount: integer('nudge_count').notNull().default(0),
    lastNudgedAt: integer('last_nudged_at', { mode: 'timestamp_ms' }),
    /** Suppresses nudging once the user has engaged, per the spec. */
    lastEngagedAt: integer('last_engaged_at', { mode: 'timestamp_ms' }),

    /**
     * Stable hash of (kind, normalized title, counterpart, due date) used for
     * deterministic dedup so the same commitment detected twice is one item.
     */
    dedupeKey: text('dedupe_key').notNull(),

    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),

    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('items_user_status_idx').on(t.userId, t.status),
    index('items_user_kind_idx').on(t.userId, t.kind),
    index('items_user_due_idx').on(t.userId, t.dueAt),
    index('items_user_followup_idx').on(t.userId, t.followUpAt),
    index('items_snoozed_idx').on(t.snoozedUntil),
    uniqueIndex('items_user_dedupe_idx').on(t.userId, t.dedupeKey),

    check('items_kind_valid', sql.raw(oneOf('kind', ITEM_KINDS))),
    check('items_status_valid', sql.raw(oneOf('status', ITEM_STATUSES))),
    check('items_priority_valid', sql.raw(oneOf('priority', PRIORITIES))),
    check('items_origin_valid', sql.raw(oneOf('origin', ORIGINS))),
    check(
      'items_confidence_valid',
      sql.raw(`confidence is null or ${oneOf('confidence', CONFIDENCE_LEVELS)}`),
    ),

    /*
     * The honesty constraint, enforced in the database.
     *
     * An AI-authored item without a confidence level would render in the UI as
     * though it were a fact the user recorded themselves. Making this a CHECK
     * means no code path — including a future one — can create that row.
     */
    check(
      'items_ai_requires_confidence',
      sql`${t.origin} <> 'ai' or (${t.confidence} is not null and ${t.reason} is not null)`,
    ),
  ],
)

/** Append-only audit trail of meaningful changes to an item. */
export const itemAuditEvents = sqliteTable(
  'item_audit_events',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    action: text('action').notNull(),
    fromValue: text('from_value'),
    toValue: text('to_value'),
    /** 'user' | 'ai' | 'system' — who made the change. */
    actor: text('actor').$type<Origin>().notNull(),
    note: text('note'),

    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [
    index('item_audit_item_idx').on(t.itemId, t.createdAt),
    check('item_audit_actor_valid', sql.raw(oneOf('actor', ORIGINS))),
  ],
)

/**
 * Join table: which sources support which item. An AI-created item must have
 * at least one row here — enforced at the repository layer, since SQLite
 * cannot express "at least one child row" as a CHECK.
 */
export const sourceReferences = sqliteTable(
  'source_references',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    sourceRecordId: text('source_record_id')
      .notNull()
      .references(() => sourceRecords.id, { onDelete: 'cascade' }),

    itemId: text('item_id').references(() => items.id, { onDelete: 'cascade' }),
    draftId: text('draft_id'),
    briefingId: text('briefing_id'),

    /** Why this source supports the claim, in plain language. */
    relevance: text('relevance'),

    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [
    index('source_refs_item_idx').on(t.itemId),
    index('source_refs_draft_idx').on(t.draftId),
    index('source_refs_source_idx').on(t.sourceRecordId),
    check(
      'source_refs_targets_something',
      sql`${t.itemId} is not null or ${t.draftId} is not null or ${t.briefingId} is not null`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('conversations_user_idx').on(t.userId, t.updatedAt)],
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    role: text('role').$type<'user' | 'assistant'>().notNull(),
    content: text('content').notNull(),

    /** 'text' | 'voice' — how the user delivered this turn. */
    inputMode: text('input_mode').$type<'text' | 'voice'>().notNull().default('text'),

    /** Which prompt version produced an assistant turn, for reproducibility. */
    promptVersion: text('prompt_version'),
    modelId: text('model_id'),

    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.createdAt),
    check('messages_role_valid', sql`${t.role} in ('user', 'assistant')`),
  ],
)

// ---------------------------------------------------------------------------
// Proposed actions — the model may propose; only the user disposes
// ---------------------------------------------------------------------------

export const proposedActions = sqliteTable(
  'proposed_actions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** e.g. 'create_item', 'complete_item', 'snooze_item', 'draft_reply'. */
    actionType: text('action_type').notNull(),
    /** Validated against a Zod schema before it is ever written here. */
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),

    summary: text('summary').notNull(),
    confidence: text('confidence').$type<ConfidenceLevel>().notNull(),

    status: text('status')
      .$type<'pending' | 'approved' | 'rejected' | 'expired'>()
      .notNull()
      .default('pending'),

    conversationId: text('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),

    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('proposed_actions_user_status_idx').on(t.userId, t.status),
    check(
      'proposed_actions_status_valid',
      sql`${t.status} in ('pending', 'approved', 'rejected', 'expired')`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export const emailThreads = sqliteTable(
  'email_threads',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').references(() => connectedAccounts.id, { onDelete: 'cascade' }),

    externalThreadId: text('external_thread_id').notNull(),
    subject: text('subject'),
    participants: text('participants', { mode: 'json' }).$type<string[]>().notNull(),

    lastMessageAt: integer('last_message_at', { mode: 'timestamp_ms' }),
    lastMessageFromMe: integer('last_message_from_me', { mode: 'boolean' })
      .notNull()
      .default(false),
    unread: integer('unread', { mode: 'boolean' }).notNull().default(false),

    /** Newsletters, receipts, notifications get grouped away from real mail. */
    category: text('category')
      .$type<'primary' | 'newsletter' | 'receipt' | 'notification' | 'other'>()
      .notNull()
      .default('primary'),

    /** Flags sensitive/financial/legal/medical content for careful review. */
    sensitivity: text('sensitivity').$type<'normal' | 'sensitive'>().notNull().default('normal'),

    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),

    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('email_threads_user_idx').on(t.userId, t.lastMessageAt),
    uniqueIndex('email_threads_user_external_idx').on(t.userId, t.externalThreadId),
  ],
)

export const emailThreadSummaries = sqliteTable(
  'email_thread_summaries',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => emailThreads.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    summary: text('summary').notNull(),
    needsReply: integer('needs_reply', { mode: 'boolean' }).notNull().default(false),
    confidence: text('confidence').$type<ConfidenceLevel>().notNull(),

    promptVersion: text('prompt_version').notNull(),
    modelId: text('model_id').notNull(),

    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [uniqueIndex('email_summaries_thread_idx').on(t.threadId)],
)

export const emailDrafts = sqliteTable(
  'email_drafts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').references(() => emailThreads.id, { onDelete: 'cascade' }),
    accountId: text('account_id').references(() => connectedAccounts.id, { onDelete: 'set null' }),

    status: text('status').$type<DraftStatus>().notNull().default('suggested'),

    /** Shown verbatim on the approval screen. No hidden recipients, ever. */
    toRecipients: text('to_recipients', { mode: 'json' }).$type<string[]>().notNull(),
    ccRecipients: text('cc_recipients', { mode: 'json' }).$type<string[]>().notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),

    confidence: text('confidence').$type<ConfidenceLevel>().notNull(),
    /** True when the thread touches financial/legal/medical/charged content. */
    requiresCarefulReview: integer('requires_careful_review', { mode: 'boolean' })
      .notNull()
      .default(false),

    snoozedUntil: integer('snoozed_until', { mode: 'timestamp_ms' }),

    /**
     * Guarantees an approved draft can never be sent twice, even if the send
     * endpoint is retried or double-submitted.
     */
    idempotencyKey: text('idempotency_key').notNull(),

    promptVersion: text('prompt_version'),
    modelId: text('model_id'),

    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),

    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('email_drafts_user_status_idx').on(t.userId, t.status),
    uniqueIndex('email_drafts_idempotency_idx').on(t.idempotencyKey),
    check('email_drafts_status_valid', sql.raw(oneOf('status', DRAFT_STATUSES))),
    /*
     * A draft cannot be marked sent without a send timestamp. The approval
     * record itself lives in draft_approvals; the send path checks for it.
     */
    check('email_drafts_sent_has_time', sql`${t.status} <> 'sent' or ${t.sentAt} is not null`),
  ],
)

/**
 * The approval gate, as data. A draft may only be sent if a matching row here
 * exists — approval is a recorded human act, not a boolean flipped in code.
 */
export const draftApprovals = sqliteTable(
  'draft_approvals',
  {
    id: text('id').primaryKey(),
    draftId: text('draft_id')
      .notNull()
      .references(() => emailDrafts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Hash of the exact recipients/subject/body the user saw and approved. */
    approvedContentHash: text('approved_content_hash').notNull(),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [uniqueIndex('draft_approvals_draft_idx').on(t.draftId)],
)

// ---------------------------------------------------------------------------
// Reminders and briefings
// ---------------------------------------------------------------------------

export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: text('item_id').references(() => items.id, { onDelete: 'cascade' }),

    level: text('level').$type<ReminderLevel>().notNull().default('gentle'),
    scheduledFor: integer('scheduled_for', { mode: 'timestamp_ms' }).notNull(),

    /** Exact wording, kept so the policy can guarantee it never repeats. */
    body: text('body').notNull(),
    bodyHash: text('body_hash').notNull(),

    status: text('status')
      .$type<'scheduled' | 'delivered' | 'suppressed' | 'cancelled'>()
      .notNull()
      .default('scheduled'),
    /** Why the policy suppressed it — shown in Settings for transparency. */
    suppressionReason: text('suppression_reason'),

    deliveredAt: integer('delivered_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [
    index('reminders_due_idx').on(t.status, t.scheduledFor),
    index('reminders_user_item_idx').on(t.userId, t.itemId),
    uniqueIndex('reminders_user_body_idx').on(t.userId, t.bodyHash),
    check('reminders_level_valid', sql.raw(oneOf('level', REMINDER_LEVELS))),
  ],
)

/** Ledger the nudge budget is computed from. Never edited, only appended. */
export const reminderEvents = sqliteTable(
  'reminder_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reminderId: text('reminder_id').references(() => reminders.id, { onDelete: 'set null' }),

    eventType: text('event_type')
      .$type<'delivered' | 'opened' | 'snoozed' | 'dismissed' | 'ignored' | 'acted'>()
      .notNull(),
    /** Local calendar day (YYYY-MM-DD) the event counts against. */
    localDate: text('local_date').notNull(),

    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [index('reminder_events_user_day_idx').on(t.userId, t.localDate, t.eventType)],
)

export const dailyBriefings = sqliteTable(
  'daily_briefings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    localDate: text('local_date').notNull(),
    shortBody: text('short_body').notNull(),
    expandedBody: text('expanded_body'),
    suggestedOrder: text('suggested_order', { mode: 'json' }).$type<string[]>().notNull(),

    promptVersion: text('prompt_version'),
    modelId: text('model_id'),

    deliveredAt: integer('delivered_at', { mode: 'timestamp_ms' }),
    spokenAt: integer('spoken_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  // One briefing per day, enforced rather than merely intended.
  (t) => [uniqueIndex('daily_briefings_user_date_idx').on(t.userId, t.localDate)],
)

/**
 * History of encouragement shown, so the app can honor "at most one per day"
 * and never repeat itself. Quotes must be public domain and accurately
 * attributed, or original and unattributed — never invented attributions.
 */
export const encouragements = sqliteTable(
  'encouragements',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    body: text('body').notNull(),
    attribution: text('attribution'),
    /** 'quote' rows require a verified attribution; 'original' must have none. */
    kind: text('kind').$type<'quote' | 'original'>().notNull(),

    localDate: text('local_date').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [
    uniqueIndex('encouragements_user_date_idx').on(t.userId, t.localDate),
    check('encouragements_kind_valid', sql`${t.kind} in ('quote', 'original')`),
    check(
      'encouragements_original_unattributed',
      sql`${t.kind} <> 'original' or ${t.attribution} is null`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Sync and job state
// ---------------------------------------------------------------------------

export const syncCursors = sqliteTable(
  'sync_cursors',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').references(() => connectedAccounts.id, { onDelete: 'cascade' }),

    resource: text('resource').notNull(),
    cursor: text('cursor'),
    lastSuccessAt: integer('last_success_at', { mode: 'timestamp_ms' }),
    lastErrorAt: integer('last_error_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),

    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [uniqueIndex('sync_cursors_scope_idx').on(t.userId, t.accountId, t.resource)],
)

export const jobRuns = sqliteTable(
  'job_runs',
  {
    id: text('id').primaryKey(),
    jobName: text('job_name').notNull(),
    status: text('status').$type<'running' | 'succeeded' | 'failed'>().notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull().default(now),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    error: text('error'),
  },
  (t) => [index('job_runs_name_idx').on(t.jobName, t.startedAt)],
)

/**
 * Consequential actions only. Deliberately records *that* something happened
 * and to which record — not the private content involved.
 */
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    actor: text('actor').$type<Origin>().notNull(),
    /** Redacted metadata only — never message bodies. */
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),

    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [index('audit_events_user_idx').on(t.userId, t.createdAt)],
)
