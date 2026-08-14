import { desc, eq } from 'drizzle-orm'
import { PageHeader } from '@/components/PageHeader'
import { REMINDER_LEVELS } from '@/core/domain/vocabulary'
import { getDb } from '@/db/client'
import { connectedAccounts, jobRuns, reminders, userPreferences } from '@/db/schema'
import { getModelProvider } from '@/server/ai/gateway'
import { checkMicrosoftEnv } from '@/server/env'
import { getSession } from '@/server/session'
import { checkDeepgramEnv, isDeepgramConfigured } from '@/server/speech/deepgram'
import { checkElevenLabsEnv, isElevenLabsConfigured } from '@/server/speech/elevenlabs'
import {
  disconnectAccountAction,
  runBriefingNow,
  runNudgeRoundNow,
  saveReminderSettings,
} from './actions'

export const metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

const FIELD = 'rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink'
const CHECKBOX_ROW = 'flex items-start gap-2 text-sm text-ink'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { userId } = await getSession()
  const db = await getDb()
  const provider = getModelProvider()
  const msEnv = checkMicrosoftEnv()
  const deepgramEnv = checkDeepgramEnv()
  const elevenLabsEnv = checkElevenLabsEnv()
  const deepgramReady = isDeepgramConfigured()
  const elevenLabsReady = isElevenLabsConfigured()

  // Outcome of a just-completed connection attempt, handed back by the OAuth
  // callback as a query parameter.
  const params = await searchParams
  const asText = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const connectSucceeded = Boolean(asText(params.connected))
  const connectMessage = asText(params.connected) ?? asText(params.connect_error) ?? null

  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1)

  const accounts = await db
    .select()
    .from(connectedAccounts)
    .where(eq(connectedAccounts.userId, userId))

  const activeAccounts = accounts.filter((a) => !a.revokedAt)
  const revokedAccounts = accounts.filter((a) => a.revokedAt)

  const recentJobs = await db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(5)

  const suppressed = await db
    .select()
    .from(reminders)
    .where(eq(reminders.userId, userId))
    .orderBy(desc(reminders.createdAt))
    .limit(8)

  if (!prefs) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Settings" />
        <p className="text-ink-muted">
          No preferences found. Run <code>npm run db:seed</code> to create the local user.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Settings &amp; Integrations"
        blurb="Reminders, quiet hours, connected accounts, privacy, and your data."
      />

      {/* --- The pause switch, first and unmissable --------------------- */}
      <section className="mb-8 rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Proactive reminders</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {prefs.proactiveRemindersPaused
            ? 'Paused. Momentum will not raise anything on its own. Everything is still visible in the app.'
            : 'Active. Momentum may speak up within your quiet hours and daily budget.'}
        </p>
        <form action={saveReminderSettings} className="mt-3">
          <input type="hidden" name="quietHoursStart" value={prefs.quietHoursStart} />
          <input type="hidden" name="quietHoursEnd" value={prefs.quietHoursEnd} />
          <input type="hidden" name="briefingTime" value={prefs.briefingTime} />
          <input type="hidden" name="reminderIntensity" value={prefs.reminderIntensity} />
          <input type="hidden" name="dailyNudgeBudget" value={prefs.dailyNudgeBudget} />
          <input type="hidden" name="maxQuotesPerDay" value={prefs.maxQuotesPerDay} />
          {prefs.quotesEnabled ? <input type="hidden" name="quotesEnabled" value="on" /> : null}
          {prefs.weekendBriefings ? (
            <input type="hidden" name="weekendBriefings" value="on" />
          ) : null}
          {prefs.weekendReminders ? (
            <input type="hidden" name="weekendReminders" value="on" />
          ) : null}
          {prefs.voiceEnabled ? <input type="hidden" name="voiceEnabled" value="on" /> : null}
          {prefs.handsFreeEnabled ? (
            <input type="hidden" name="handsFreeEnabled" value="on" />
          ) : null}
          {prefs.storeAudio ? <input type="hidden" name="storeAudio" value="on" /> : null}
          {prefs.proactiveRemindersPaused ? null : (
            <input type="hidden" name="proactiveRemindersPaused" value="on" />
          )}
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            {prefs.proactiveRemindersPaused ? 'Resume reminders' : 'Pause all proactive reminders'}
          </button>
        </form>
      </section>

      {/* --- Full preference form --------------------------------------- */}
      <form action={saveReminderSettings} className="mb-8 space-y-6">
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink">When Momentum may speak</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="quietHoursStart" className="block text-sm text-ink-muted">
                Quiet hours start
              </label>
              <input
                id="quietHoursStart"
                name="quietHoursStart"
                type="time"
                defaultValue={prefs.quietHoursStart}
                className={`mt-1 w-full ${FIELD}`}
              />
            </div>
            <div>
              <label htmlFor="quietHoursEnd" className="block text-sm text-ink-muted">
                Quiet hours end
              </label>
              <input
                id="quietHoursEnd"
                name="quietHoursEnd"
                type="time"
                defaultValue={prefs.quietHoursEnd}
                className={`mt-1 w-full ${FIELD}`}
              />
            </div>
            <div>
              <label htmlFor="briefingTime" className="block text-sm text-ink-muted">
                Morning briefing at
              </label>
              <input
                id="briefingTime"
                name="briefingTime"
                type="time"
                defaultValue={prefs.briefingTime}
                className={`mt-1 w-full ${FIELD}`}
              />
            </div>
            <div>
              <label htmlFor="dailyNudgeBudget" className="block text-sm text-ink-muted">
                Nudges per day (0–10)
              </label>
              <input
                id="dailyNudgeBudget"
                name="dailyNudgeBudget"
                type="number"
                min={0}
                max={10}
                defaultValue={prefs.dailyNudgeBudget}
                className={`mt-1 w-full ${FIELD}`}
              />
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="reminderIntensity" className="block text-sm text-ink-muted">
              Reminder style
            </label>
            <select
              id="reminderIntensity"
              name="reminderIntensity"
              defaultValue={prefs.reminderIntensity}
              className={`mt-1 w-full ${FIELD}`}
            >
              {REMINDER_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-faint">
              Momentum stays at or below this level. “silent” means nothing is ever raised
              proactively — items are still visible in the app.
            </p>
          </div>

          <div className="mt-4 space-y-2">
            <label className={CHECKBOX_ROW}>
              <input
                type="checkbox"
                name="weekendReminders"
                defaultChecked={prefs.weekendReminders}
              />
              <span>Allow reminders at weekends</span>
            </label>
            <label className={CHECKBOX_ROW}>
              <input
                type="checkbox"
                name="weekendBriefings"
                defaultChecked={prefs.weekendBriefings}
              />
              <span>Send a briefing at weekends</span>
            </label>
          </div>
        </section>

        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink">Encouragement</h2>
          <div className="mt-3 space-y-2">
            <label className={CHECKBOX_ROW}>
              <input type="checkbox" name="quotesEnabled" defaultChecked={prefs.quotesEnabled} />
              <span>Include a short encouragement in the briefing</span>
            </label>
          </div>
          <div className="mt-3">
            <label htmlFor="maxQuotesPerDay" className="block text-sm text-ink-muted">
              At most, per day
            </label>
            <input
              id="maxQuotesPerDay"
              name="maxQuotesPerDay"
              type="number"
              min={0}
              max={3}
              defaultValue={prefs.maxQuotesPerDay}
              className={`mt-1 w-32 ${FIELD}`}
            />
          </div>
        </section>

        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink">Voice</h2>
          <div className="mt-3 space-y-2">
            <label className={CHECKBOX_ROW}>
              <input type="checkbox" name="voiceEnabled" defaultChecked={prefs.voiceEnabled} />
              <span>Enable voice mode</span>
            </label>
            <label className={CHECKBOX_ROW}>
              <input
                type="checkbox"
                name="handsFreeEnabled"
                defaultChecked={prefs.handsFreeEnabled}
              />
              <span>
                Allow hands-free mode
                <span className="block text-xs text-ink-faint">
                  Even when allowed, listening only ever starts from a deliberate press.
                </span>
              </span>
            </label>
            <label className={CHECKBOX_ROW}>
              <input type="checkbox" name="storeAudio" defaultChecked={prefs.storeAudio} />
              <span>
                Store raw audio
                <span className="block text-xs text-ink-faint">
                  Off by default. Momentum keeps only text transcripts.
                </span>
              </span>
            </label>
          </div>
        </section>

        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          Save settings
        </button>
      </form>

      {/* --- Integrations ----------------------------------------------- */}
      <section className="mb-8 rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Connected accounts</h2>

        {connectMessage ? (
          <p
            className={`mt-2 rounded-md px-3 py-2 text-sm ${
              connectSucceeded ? 'bg-done-soft text-done' : 'bg-urgent-soft text-urgent'
            }`}
          >
            {connectMessage}
          </p>
        ) : null}

        {activeAccounts.length === 0 ? (
          <div className="mt-2 text-sm text-ink-muted">
            <p>
              No account is connected. Momentum is running on demo data, and nothing can leave this
              machine.
            </p>

            {msEnv.ok ? (
              <>
                <p className="mt-3">
                  Momentum will request read-only access only:{' '}
                  <code className="rounded bg-surface-sunken px-1 text-xs">
                    offline_access User.Read Mail.Read MailboxSettings.Read
                  </code>
                  . It does not ask for permission to send, delete, or modify mail, and it refuses
                  the connection if more is granted.
                </p>
                <a
                  href="/api/integrations/microsoft/start"
                  className="mt-3 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
                >
                  Connect Outlook
                </a>
              </>
            ) : (
              <div className="mt-3 rounded-md border border-line bg-surface-sunken p-3">
                <p className="font-medium text-ink">
                  Not configured yet. {msEnv.problems.length}{' '}
                  {msEnv.problems.length === 1 ? 'thing is' : 'things are'} missing:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-muted">
                  {msEnv.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-faint">
                  Add these to <code className="rounded bg-surface px-1">.env.local</code> and
                  restart the server.
                </p>
              </div>
            )}
          </div>
        ) : (
          <ul className="mt-3 space-y-4">
            {activeAccounts.map((account) => (
              <li key={account.id} className="text-sm">
                <span className="font-medium text-ink">{account.accountLabel}</span>{' '}
                <span className="text-ink-muted">({account.provider})</span>
                <div className="text-xs text-ink-faint">
                  Scopes: {account.grantedScopes.join(', ') || 'none'}
                </div>
                <div className="text-xs text-ink-faint">
                  Last sync:{' '}
                  {account.lastSyncedAt ? account.lastSyncedAt.toLocaleString() : 'never'}
                </div>
                {account.tokenExpiresAt ? (
                  <div className="text-xs text-ink-faint">
                    Access renews automatically; the current token expires{' '}
                    {account.tokenExpiresAt.toLocaleString()}.
                  </div>
                ) : null}
                {/* Credentials gone while the account is still listed means a
                    refresh failed permanently. Say so, and offer the only fix. */}
                {account.accessTokenEncrypted ? (
                  account.lastSyncError ? (
                    <p className="mt-2 text-xs text-urgent">{account.lastSyncError}</p>
                  ) : null
                ) : (
                  <div className="mt-2 rounded-md bg-urgent-soft px-3 py-2 text-sm text-urgent">
                    <p>{account.lastSyncError ?? 'Sign-in expired.'}</p>
                    {msEnv.ok ? (
                      <a
                        href="/api/integrations/microsoft/start"
                        className="mt-1 inline-block font-medium underline"
                      >
                        Reconnect this account
                      </a>
                    ) : null}
                  </div>
                )}
                <form action={disconnectAccountAction} className="mt-2">
                  <input type="hidden" name="accountId" value={account.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-sunken"
                  >
                    Disconnect and delete stored credentials
                  </button>
                </form>
                <p className="mt-1 text-xs text-ink-faint">
                  This destroys the tokens held here and removes synced mail metadata. It cannot
                  revoke Momentum&rsquo;s access at Microsoft&rsquo;s end — do that from your
                  account&rsquo;s app permissions page if you want it fully withdrawn.
                </p>
              </li>
            ))}
          </ul>
        )}

        {revokedAccounts.length > 0 ? (
          <p className="mt-4 text-xs text-ink-faint">
            {revokedAccounts.length} previously connected{' '}
            {revokedAccounts.length === 1 ? 'account has' : 'accounts have'} been disconnected.
            Their credentials were destroyed.
          </p>
        ) : null}
      </section>

      {/* --- Voice providers -------------------------------------------- */}
      <section className="mb-8 rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Voice</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Whether hosted speech providers are set up. These are optional — voice works without them.
        </p>

        <div className="mt-4 space-y-4">
          {/* Speech-to-text */}
          <div>
            <p className="text-sm font-medium text-ink">Speech-to-text (Deepgram)</p>
            {deepgramReady ? (
              <p className="mt-1 text-sm text-ink-muted">
                Configured — Momentum will transcribe your voice with Deepgram.
              </p>
            ) : (
              <div className="mt-2 rounded-md border border-line bg-surface-sunken p-3">
                <p className="text-sm font-medium text-ink">
                  Not configured yet. {deepgramEnv.problems.length}{' '}
                  {deepgramEnv.problems.length === 1 ? 'thing is' : 'things are'} missing:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-muted">
                  {deepgramEnv.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Text-to-speech */}
          <div>
            <p className="text-sm font-medium text-ink">Text-to-speech (ElevenLabs)</p>
            {elevenLabsReady ? (
              <p className="mt-1 text-sm text-ink-muted">
                Configured — replies can be read aloud in an ElevenLabs voice.
              </p>
            ) : (
              <div className="mt-2 rounded-md border border-line bg-surface-sunken p-3">
                <p className="text-sm font-medium text-ink">
                  Not configured yet. {elevenLabsEnv.problems.length}{' '}
                  {elevenLabsEnv.problems.length === 1 ? 'thing is' : 'things are'} missing:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-muted">
                  {elevenLabsEnv.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {!deepgramReady && !elevenLabsReady ? (
          <p className="mt-4 text-xs text-ink-faint">
            No hosted voice is configured. Voice still works using your browser&rsquo;s built-in
            speech, which varies by browser.
          </p>
        ) : null}
      </section>

      {/* --- Privacy ----------------------------------------------------- */}
      <section className="mb-8 rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">What Momentum reads, stores, and shares</h2>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="font-medium text-ink">Reads</dt>
            <dd className="text-ink-muted">
              With an account connected: message metadata and bodies, read-only. Right now: nothing
              — no account is connected.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Stores</dt>
            <dd className="text-ink-muted">
              Short excerpts rather than whole message bodies, plus the tasks and commitments
              derived from them. Everything lives in a local SQLite file on this machine. Raw audio
              is never stored.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Infers</dt>
            <dd className="text-ink-muted">
              Commitments, waiting-for items, and possible loose ends. Every inference carries a
              confidence level and a link to what it was based on. Inferences are never presented as
              facts.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Shares with the model provider</dt>
            <dd className="text-ink-muted">
              {provider.id === 'deterministic' ? (
                <>Nothing. No model key is configured, so no content leaves this machine at all.</>
              ) : (
                <>
                  Only the excerpts needed for an enabled feature are sent to Anthropic — never a
                  whole mailbox or full history.
                </>
              )}
            </dd>
          </div>
        </dl>
      </section>

      {/* --- Transparency about silence ---------------------------------- */}
      <section className="mb-8 rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Recent reminder decisions</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Including the ones Momentum decided not to send, and why.
        </p>
        {suppressed.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">No reminder rounds have run yet.</p>
        ) : (
          <ul className="mt-3 space-y-1 text-xs text-ink-faint">
            {suppressed.map((reminder) => (
              <li key={reminder.id}>
                <span className="font-medium text-ink-muted">{reminder.status}</span>
                {reminder.suppressionReason ? ` — ${reminder.suppressionReason}` : ''}
                {reminder.status === 'delivered' ? ` — “${reminder.body}”` : ''}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <form action={runNudgeRoundNow}>
            <button
              type="submit"
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-sunken"
            >
              Run a reminder round now
            </button>
          </form>
          <form action={runBriefingNow}>
            <button
              type="submit"
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-sunken"
            >
              Generate today&rsquo;s briefing
            </button>
          </form>
        </div>
      </section>

      {/* --- Job status --------------------------------------------------- */}
      <section className="mb-8 rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Background jobs</h2>
        {recentJobs.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint">Nothing has run yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs text-ink-faint">
            {recentJobs.map((job) => (
              <li key={job.id}>
                <span className="font-medium text-ink-muted">{job.jobName}</span> — {job.status}
                {job.error ? ` — ${job.error}` : ''} · {job.startedAt.toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Your data ----------------------------------------------------- */}
      <section className="mb-8 rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Your data</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Everything Momentum knows lives in <code>momentum.db</code> in the project folder.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href="/api/export"
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-sunken"
          >
            Export everything as JSON
          </a>
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          To delete everything, stop the app and delete <code>momentum.db</code>. A one-click delete
          is deliberately not offered while this is a local single-user build — an irreversible wipe
          behind a single button is a worse risk than the inconvenience.
        </p>
      </section>
    </div>
  )
}
