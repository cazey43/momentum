import { and, asc, desc, eq } from 'drizzle-orm'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { TalkComposer } from '@/components/TalkComposer'
import { getDb } from '@/db/client'
import { conversations, messages, proposedActions } from '@/db/schema'
import { getModelProvider } from '@/server/ai/gateway'
import { getSession } from '@/server/session'
import { getSpeechAvailability } from '@/server/speech/config'
import { approveProposedAction, dismissProposedAction, sendChatMessage } from './actions'

export const metadata = { title: 'Talk' }
export const dynamic = 'force-dynamic'

const ACTION_LABELS: Record<string, string> = {
  create_item: 'Create an item',
  complete_item: 'Mark as done',
  snooze_item: 'Set aside until later',
  mute_reminders: 'Stop reminding you',
}

export default async function TalkPage() {
  const { userId } = await getSession()
  const db = await getDb()
  const provider = getModelProvider()

  const [latestConversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(1)

  const turns = latestConversation
    ? await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, latestConversation.id))
        .orderBy(asc(messages.createdAt))
    : []

  const lastAssistantReply =
    [...turns].reverse().find((turn) => turn.role === 'assistant')?.content ?? null

  const pending = await db
    .select()
    .from(proposedActions)
    .where(and(eq(proposedActions.userId, userId), eq(proposedActions.status, 'pending')))
    .orderBy(desc(proposedActions.createdAt))

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Talk" blurb="Type naturally. Nothing changes until you approve it.">
        {provider.id === 'deterministic' ? (
          <p className="mt-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
            Running without a model key, so replies are limited to simple phrases like &ldquo;I
            handled that&rdquo; or &ldquo;remind me tomorrow&rdquo;. Add
            <code className="mx-1 rounded bg-surface px-1 py-0.5 text-xs">ANTHROPIC_API_KEY</code>
            to <code className="rounded bg-surface px-1 py-0.5 text-xs">.env.local</code> for full
            conversation.
          </p>
        ) : null}
      </PageHeader>

      <div className="space-y-3">
        {turns.length === 0 ? (
          <EmptyState
            message="No conversation yet."
            hint="Try: “What needs my attention today?” or “I handled the contract.”"
          />
        ) : (
          turns.map((turn) => (
            <div
              key={turn.id}
              className={
                turn.role === 'user'
                  ? 'ml-8 rounded-card bg-accent-soft p-3 text-sm text-ink'
                  : 'mr-8 rounded-card border border-line bg-surface p-3 text-sm text-ink'
              }
            >
              <p className="mb-1 text-xs font-medium text-ink-faint">
                {turn.role === 'user' ? 'You' : 'Momentum'}
              </p>
              <p className="whitespace-pre-wrap">{turn.content}</p>
            </div>
          ))
        )}
      </div>

      {pending.length > 0 ? (
        <section className="mt-6" aria-labelledby="pending-heading">
          <h2 id="pending-heading" className="mb-3 text-sm font-semibold text-ink">
            Waiting for your approval
          </h2>
          <div className="space-y-3">
            {pending.map((action) => (
              <div key={action.id} className="rounded-card border border-line bg-surface p-4">
                <p className="font-medium text-ink">
                  {ACTION_LABELS[action.actionType] ?? action.actionType}
                </p>
                <p className="mt-1 text-sm text-ink-muted">{action.summary}</p>

                <div className="mt-3 flex gap-2">
                  <form action={approveProposedAction}>
                    <input type="hidden" name="actionId" value={action.id} />
                    <button
                      type="submit"
                      className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
                    >
                      Approve
                    </button>
                  </form>
                  <form action={dismissProposedAction}>
                    <input type="hidden" name="actionId" value={action.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-sunken"
                    >
                      Not that
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <TalkComposer
        action={sendChatMessage}
        conversationId={latestConversation?.id ?? null}
        lastReply={lastAssistantReply}
        speech={getSpeechAvailability()}
      />
    </div>
  )
}
