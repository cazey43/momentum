import { z } from 'zod'
import { CONFIDENCE_LEVELS, ITEM_KINDS } from '@/core/domain/vocabulary'

/**
 * Every structured output the model is allowed to produce.
 *
 * This is the narrow waist of the trust boundary: whatever the model writes,
 * only these shapes get through. There is no free-text field that is later
 * interpreted as a command, and no field that names a database id the model
 * invented — proposed actions reference items by id only when the id was given
 * to the model in the first place, and the server re-checks ownership anyway.
 */

export const confidenceSchema = z.enum(CONFIDENCE_LEVELS)
export const itemKindSchema = z.enum(ITEM_KINDS)

/**
 * An action the assistant would like to take. It is a *proposal*: nothing in
 * this object is executed without passing back through server-side checks, and
 * consequential ones additionally require explicit user approval.
 */
export const proposedActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_item'),
    kind: itemKindSchema,
    title: z.string().min(1).max(200),
    detail: z.string().max(1000).nullable(),
    /** ISO date (YYYY-MM-DD) or null. Never a relative phrase. */
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    counterpartName: z.string().max(120).nullable(),
    confidence: confidenceSchema,
    /** Why this is being proposed, in the user's terms. */
    reason: z.string().min(1).max(400),
  }),
  z.object({
    type: z.literal('complete_item'),
    itemId: z.string().min(1),
    reason: z.string().min(1).max(400),
  }),
  z.object({
    type: z.literal('snooze_item'),
    itemId: z.string().min(1),
    untilDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().min(1).max(400),
  }),
  z.object({
    type: z.literal('mute_reminders'),
    itemId: z.string().min(1),
    /** 'once' honors "remind me only once"; 'forever' honors "stop reminding me". */
    scope: z.enum(['once', 'forever']),
    reason: z.string().min(1).max(400),
  }),
])

export type ProposedAction = z.infer<typeof proposedActionSchema>

/**
 * The assistant's conversational turn.
 *
 * `uncertain` exists so the model has a sanctioned way to say "I don't know"
 * instead of inventing something — the spec requires admitting uncertainty
 * rather than pretending.
 */
export const chatResponseSchema = z.object({
  reply: z.string().min(1).max(4000),
  /** Actions to offer the user. Empty when the turn is purely conversational. */
  proposedActions: z.array(proposedActionSchema).max(5),
  /** Set when the assistant could not determine something it was asked. */
  uncertain: z.boolean(),
  /**
   * Set when retrieved content appeared to contain instructions aimed at the
   * assistant. Surfaced to the user rather than acted upon.
   */
  suspiciousContentNoticed: z.boolean(),
})

export type ChatResponse = z.infer<typeof chatResponseSchema>

/** Commitment / loose-end detection over a single source. */
export const detectedCommitmentSchema = z.object({
  kind: itemKindSchema,
  title: z.string().min(1).max(200),
  /** The exact words from the source that support this. Never paraphrased. */
  evidenceQuote: z.string().min(1).max(500),
  counterpartName: z.string().max(120).nullable(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  confidence: confidenceSchema,
  reason: z.string().min(1).max(400),
})

export const detectionResultSchema = z.object({
  detections: z.array(detectedCommitmentSchema).max(10),
  suspiciousContentNoticed: z.boolean(),
})

export type DetectionResult = z.infer<typeof detectionResultSchema>

/** Thread summarization for the email assistant. */
export const threadSummarySchema = z.object({
  summary: z.string().min(1).max(1200),
  needsReply: z.boolean(),
  /** Financial, legal, medical, or emotionally charged content. */
  requiresCarefulReview: z.boolean(),
  category: z.enum(['primary', 'newsletter', 'receipt', 'notification', 'other']),
  confidence: confidenceSchema,
  suspiciousContentNoticed: z.boolean(),
})

export type ThreadSummary = z.infer<typeof threadSummarySchema>

/** A drafted reply. Recipients are supplied by the server, never the model. */
export const draftReplySchema = z.object({
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(6000),
  confidence: confidenceSchema,
  requiresCarefulReview: z.boolean(),
  /** Anything the model had to guess, listed so the user can check it. */
  assumptions: z.array(z.string().max(300)).max(5),
})

export type DraftReply = z.infer<typeof draftReplySchema>

/** The daily briefing. */
export const briefingSchema = z.object({
  short: z.string().min(1).max(1500),
  expanded: z.string().min(1).max(4000),
  /** Item ids, in the order the assistant suggests tackling them. */
  suggestedOrder: z.array(z.string()).max(10),
  /** Optional single line of encouragement. */
  encouragement: z
    .object({
      body: z.string().min(1).max(300),
      kind: z.enum(['quote', 'original']),
      /** Must be null when kind is 'original'. Enforced again in the database. */
      attribution: z.string().max(120).nullable(),
    })
    .nullable(),
})

export type Briefing = z.infer<typeof briefingSchema>
