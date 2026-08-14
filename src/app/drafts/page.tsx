import { and, desc, eq, ne } from 'drizzle-orm'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { canSend } from '@/core/ports/email'
import { getDb } from '@/db/client'
import { loadSourcesForDraft } from '@/db/repositories/sources'
import { emailDrafts } from '@/db/schema'
import { computeContentHash } from '@/server/email/drafts'
import { getEmailProvider } from '@/server/email/provider'
import { getSession } from '@/server/session'
import {
  approveDraftAction,
  dismissDraftAction,
  sendDraftAction,
  snoozeDraftAction,
} from './actions'

export const metadata = { title: 'Drafts' }
export const dynamic = 'force-dynamic'

const SMALL_BUTTON =
  'rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-sunken'

export default async function DraftsPage() {
  const { userId } = await getSession()
  const db = await getDb()
  const { provider, isDemo, accountLabel, problem, needsReconnect } = await getEmailProvider(userId)
  const sendable = canSend(provider)

  const drafts = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.userId, userId), ne(emailDrafts.status, 'dismissed')))
    .orderBy(desc(emailDrafts.createdAt))

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Drafts"
        blurb="Replies prepared for you. Nothing is sent until you approve it and then choose to send."
      >
        {/* A real account that is not usable must never be papered over with
            demo data presented as the user's own mail. */}
        {problem ? (
          <p className="mt-3 rounded-md bg-urgent-soft px-3 py-2 text-sm text-urgent">
            {problem}{' '}
            {needsReconnect ? (
              <a href="/settings" className="font-medium underline">
                Reconnect in Settings
              </a>
            ) : null}
          </p>
        ) : null}

        <p className="mt-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          {isDemo ? (
            <>
              Using the <strong>demo mailbox</strong> ({accountLabel}). No account is connected, so
              nothing can leave this machine.
            </>
          ) : (
            <>
              Connected to <strong>{accountLabel}</strong>.
            </>
          )}{' '}
          {sendable
            ? 'This account is permitted to send.'
            : 'This connection is read-only, so sending is disabled.'}
        </p>
      </PageHeader>

      {drafts.length === 0 ? (
        <EmptyState
          message="No drafts waiting."
          hint="Momentum prepares a reply when a message clearly needs one."
        />
      ) : (
        <div className="space-y-4">
          {drafts.map(async (draft) => {
            const contentHash = computeContentHash({
              toRecipients: draft.toRecipients,
              ccRecipients: draft.ccRecipients,
              subject: draft.subject,
              body: draft.body,
            })
            const evidence = await loadSourcesForDraft(userId, draft.id)
            const isApproved = draft.status === 'approved'
            const isSent = draft.status === 'sent'

            return (
              <article key={draft.id} className="rounded-card border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-medium text-ink-muted">
                    {draft.status}
                  </span>
                  {draft.isDemo ? (
                    <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-faint">
                      Demo data
                    </span>
                  ) : null}
                </div>

                {draft.requiresCarefulReview ? (
                  <p className="mt-3 rounded-md bg-urgent-soft px-3 py-2 text-sm text-urgent">
                    This touches money, legal, medical, or sensitive ground. Read it closely before
                    approving.
                  </p>
                ) : null}

                {/* Exact recipients, subject, and body — shown in full before
                    approval, as the spec requires. Nothing is truncated. */}
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-ink-faint">To</dt>
                    <dd className="text-ink">{draft.toRecipients.join(', ')}</dd>
                  </div>
                  {draft.ccRecipients.length > 0 ? (
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-ink-faint">Cc</dt>
                      <dd className="text-ink">{draft.ccRecipients.join(', ')}</dd>
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-ink-faint">Subject</dt>
                    <dd className="text-ink">{draft.subject}</dd>
                  </div>
                </dl>

                <pre className="mt-3 rounded-md border border-line bg-surface-sunken p-3 font-sans text-sm whitespace-pre-wrap text-ink">
                  {draft.body}
                </pre>

                {evidence.length > 0 ? (
                  <div className="mt-3 rounded-md border border-line bg-surface-sunken/60 p-3">
                    <p className="text-xs font-medium text-ink-muted">Written in reply to</p>
                    <ul className="mt-1 space-y-1">
                      {evidence.map((source) => (
                        <li key={source.id} className="text-xs text-ink-faint">
                          {source.title}
                          {source.author ? ` · ${source.author}` : ''}
                          {source.excerpt ? (
                            <span className="mt-0.5 block border-l-2 border-line pl-2 italic">
                              “{source.excerpt}”
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {isSent ? (
                  <p className="mt-3 text-sm text-done">Sent.</p>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {!isApproved ? (
                      <form action={approveDraftAction}>
                        <input type="hidden" name="draftId" value={draft.id} />
                        <input type="hidden" name="contentHash" value={contentHash} />
                        <button
                          type="submit"
                          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
                        >
                          Approve
                        </button>
                      </form>
                    ) : (
                      <form action={sendDraftAction}>
                        <input type="hidden" name="draftId" value={draft.id} />
                        <button
                          type="submit"
                          disabled={!sendable}
                          title={
                            sendable
                              ? undefined
                              : 'This account is read-only, so Momentum cannot send from it.'
                          }
                          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Send it
                        </button>
                      </form>
                    )}

                    <form action={snoozeDraftAction}>
                      <input type="hidden" name="draftId" value={draft.id} />
                      <input type="hidden" name="days" value="2" />
                      <button type="submit" className={SMALL_BUTTON}>
                        Later
                      </button>
                    </form>

                    <form action={dismissDraftAction}>
                      <input type="hidden" name="draftId" value={draft.id} />
                      <button type="submit" className={SMALL_BUTTON}>
                        Discard
                      </button>
                    </form>
                  </div>
                )}

                {isApproved && !sendable ? (
                  <p className="mt-2 text-sm text-ink-muted">
                    Approved. Connect an account with send permission in Settings to actually send
                    it.
                  </p>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
