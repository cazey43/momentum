import { and, asc, eq } from 'drizzle-orm'
import type { BucketContext } from '@/core/domain/items'
import { bucketOf } from '@/core/domain/items'
import { ITEM_KIND_LABELS } from '@/core/domain/vocabulary'
import { ModelOutputInvalidError, ModelRefusalError } from '@/core/ports/model'
import { getDb } from '@/db/client'
import { listItems } from '@/db/repositories/items'
import { conversations, messages, proposedActions } from '@/db/schema'
import { chatPrompt } from '@/prompts/chat'
import { promptLabel } from '@/prompts/types'
import { getModelProvider } from './gateway'
import { type ChatResponse, chatResponseSchema } from './schemas'
import type { UntrustedBlock } from './untrusted'

export interface ChatTurnResult {
  conversationId: string
  reply: string
  uncertain: boolean
  suspiciousContentNoticed: boolean
  /** Ids of proposed actions written for this turn, pending approval. */
  proposedActionIds: string[]
  isDeterministic: boolean
}

/**
 * Builds the item context the assistant reasons over.
 *
 * Item titles can originate from email bodies, so they are untrusted content
 * and get fenced like any other retrieved data — even though they now live in
 * our own database. Provenance, not storage location, decides trust.
 */
async function buildItemContext(userId: string, ctx: BucketContext): Promise<UntrustedBlock[]> {
  const all = await listItems(userId)
  const relevant = all
    .filter((item) => {
      const bucket = bucketOf(item, ctx)
      return bucket !== 'completed' && bucket !== 'someday'
    })
    .slice(0, 40)

  if (relevant.length === 0) return []

  const lines = relevant.map((item) => {
    const bucket = bucketOf(item, ctx)
    const due = item.dueAt ? ` due:${item.dueAt.toISOString().slice(0, 10)}` : ''
    const who = item.counterpartName ? ` with:${item.counterpartName}` : ''
    return `${item.id} [${ITEM_KIND_LABELS[item.kind]}/${bucket}]${due}${who} — ${item.title}`
  })

  return [
    {
      label: "the user's current open items",
      content: lines.join('\n'),
    },
  ]
}

async function ensureConversation(userId: string, conversationId: string | null): Promise<string> {
  const db = await getDb()
  if (conversationId) {
    const existing = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
      .limit(1)
    if (existing[0]) return conversationId
  }

  const id = `conv_${Date.now().toString(36)}`
  await db.insert(conversations).values({ id, userId, title: null })
  return id
}

/** Recent turns, so the assistant has short-term memory of the conversation. */
async function recentTurns(conversationId: string, limit = 12): Promise<string> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .limit(limit)

  return rows
    .map((row) => `${row.role === 'user' ? 'User' : 'Momentum'}: ${row.content}`)
    .join('\n')
}

export async function respondToMessage(
  userId: string,
  ctx: BucketContext,
  conversationId: string | null,
  userText: string,
  inputMode: 'text' | 'voice' = 'text',
): Promise<ChatTurnResult> {
  const db = await getDb()
  const provider = getModelProvider()
  const convId = await ensureConversation(userId, conversationId)

  await db.insert(messages).values({
    id: `msg_${Date.now().toString(36)}_u`,
    conversationId: convId,
    userId,
    role: 'user',
    content: userText,
    inputMode,
  })

  const history = await recentTurns(convId)
  const itemContext = await buildItemContext(userId, ctx)

  const input = [
    `Today is ${ctx.now.toISOString().slice(0, 10)} in the user's timezone (${ctx.zone}).`,
    '',
    history ? `Recent conversation:\n${history}` : '',
    '',
    `The user just said: ${userText}`,
  ]
    .filter(Boolean)
    .join('\n')

  let result: ChatResponse
  let isDeterministic = false
  let modelId = provider.id

  try {
    const response = await provider.generateStructured({
      promptId: chatPrompt.id,
      promptVersion: chatPrompt.version,
      system: chatPrompt.system,
      input,
      untrusted: itemContext,
      schema: chatResponseSchema,
    })
    result = response.data
    isDeterministic = response.isDeterministic
    modelId = response.modelId
  } catch (error) {
    // Failures are reported honestly rather than dressed up as an answer.
    const reply =
      error instanceof ModelRefusalError
        ? 'I was not able to answer that one. Nothing has been changed.'
        : error instanceof ModelOutputInvalidError
          ? 'I got a garbled response and would rather not guess. Try rephrasing?'
          : 'Something went wrong reaching the model. Nothing has been changed.'

    await db.insert(messages).values({
      id: `msg_${Date.now().toString(36)}_e`,
      conversationId: convId,
      userId,
      role: 'assistant',
      content: reply,
      promptVersion: promptLabel(chatPrompt),
      modelId: provider.id,
    })

    return {
      conversationId: convId,
      reply,
      uncertain: true,
      suspiciousContentNoticed: false,
      proposedActionIds: [],
      isDeterministic,
    }
  }

  await db.insert(messages).values({
    id: `msg_${Date.now().toString(36)}_a`,
    conversationId: convId,
    userId,
    role: 'assistant',
    content: result.reply,
    promptVersion: promptLabel(chatPrompt),
    modelId,
  })

  // Proposals are persisted as pending. Nothing here executes.
  const proposedActionIds: string[] = []
  for (const [index, action] of result.proposedActions.entries()) {
    const id = `pa_${Date.now().toString(36)}_${index}`
    await db.insert(proposedActions).values({
      id,
      userId,
      actionType: action.type,
      payload: action,
      summary: action.reason,
      confidence: 'confidence' in action ? action.confidence : 'medium',
      status: 'pending',
      conversationId: convId,
    })
    proposedActionIds.push(id)
  }

  return {
    conversationId: convId,
    reply: result.reply,
    uncertain: result.uncertain,
    suspiciousContentNoticed: result.suspiciousContentNoticed,
    proposedActionIds,
    isDeterministic,
  }
}
