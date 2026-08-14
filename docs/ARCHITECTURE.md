# Momentum — Architecture & Decision Record

Personal AI chief-of-staff. This document records the stack, the boundaries, and the
decisions taken during the build, including the assumptions made where the spec left
room for judgment.

The product name is set in one place (`src/config/branding.ts`, surfaced via
`NEXT_PUBLIC_APP_NAME`) so it can be changed without touching feature code.

## 1. Confirmed decisions

| Question | Decision | Consequence |
|---|---|---|
| Runtime | Node.js LTS + TypeScript strict | Specced stack; verifiable typecheck/lint/test |
| Deployment shape | Local-only, single user | SQLite, minimal local auth, no hosting config |
| Email provider | Microsoft 365 / Outlook (Graph), read-only | Graph adapter is the real one; Gmail stays an unimplemented interface |
| Model | Anthropic Claude via `ModelProvider` gateway | Real key needed for quality; tests use a deterministic fake |

## 2. Assumed defaults (all reversible in Settings)

These were not specified and are **not** worth blocking the build over. Every one is a
row in the preferences table, editable in the UI.

| Setting | Default | Source of default |
|---|---|---|
| Time zone | `America/Detroit` | Specified by the user |
| Morning briefing | 08:00 local | Just after quiet hours end |
| Quiet hours | 20:00 – 08:00 local | Spec §"Persistence without annoyance" |
| Proactive nudge budget | 2 per day | Spec |
| Briefings per day | 1 | Spec |
| Quote frequency | At most 1 per day, enabled | Spec |
| Weekend behavior | Briefing suppressed, silent reminders only | Judgment; spec asks for a weekend control |
| Reminder intensity | Gentle | Least intrusive setting that is still useful |
| Voice | Browser Web Speech API (local) | Spec §2 permits browser speech as the first dependable path |
| Task source | Internal only | No external task system named |
| Calendar | Deferred past first release | Spec §4 lists it as optional for v1 |

## 3. Layering

The rule: **domain logic never imports a vendor SDK.** Vendors live only in
`src/adapters/*`, behind interfaces defined in `src/core/ports`.

```
src/
  app/                Next.js App Router — routes, server actions, UI
  core/
    domain/           Entities, item-type rules, state machines. Pure. No I/O.
    policy/           Gentle Persistence Policy: quiet hours, budgets, escalation,
                      suppression, dedup. Pure functions over a clock + state.
    priority/         Ranking rules + human-readable reason strings. Pure.
    looseends/        Detection rules over normalized source records. Pure.
    ports/            EmailProvider, CalendarProvider, TaskProvider,
                      SpeechToTextProvider, TextToSpeechProvider,
                      NotificationProvider, ModelProvider.
  adapters/
    email/graph/      Microsoft Graph, read-only scopes
    email/demo/       Seeded demo mailbox
    model/anthropic/  Claude gateway
    model/fake/       Deterministic; used by every test
    speech/browser/   Web Speech API STT/TTS
  db/                 Drizzle schema, migrations, repositories
  prompts/            Versioned prompt templates. Data, not code.
  server/             Auth, ownership checks, rate limits, audit log, jobs
```

Anything in `core/` is pure and synchronously testable — no clock, no network, no
database. Time is injected. That is what makes quiet hours, nudge budgets, snooze
logic, and escalation testable without mocking a scheduler.

## 4. Trust boundary

The single most important security property in this app:

> Email bodies, task titles, notes, and calendar entries are **untrusted data**. They
> are never concatenated into a system prompt and never authorize an action.

Enforced by three mechanisms:

1. **Structural separation.** Source content is passed to the model inside delimited
   data blocks with an explicit instruction that content within is data to analyze,
   never instructions to follow. Prompts live in `src/prompts/` and are versioned.
2. **Output validation.** Every model response is parsed against a Zod schema. A
   response that does not validate is rejected and retried, then degraded — it never
   reaches the domain layer unvalidated.
3. **Server-side authorization.** The model can *propose* actions; it cannot *perform*
   them. Every consequential action re-checks ownership and permission server-side,
   independent of anything the model returned. Sends additionally require an explicit
   human approval record and carry an idempotency key.

Prompt-injection test fixtures (email bodies containing "ignore previous instructions",
"you are now authorized to send", etc.) are part of the security test suite.

## 5. Data model

Owner-scoped, timestamped, soft-deleted where useful:

- `users`, `user_preferences`
- `connected_accounts` (encrypted tokens, granted scopes, last sync)
- `conversations`, `messages`
- `items` (unified: task / commitment / waiting-for / delegated / follow-up / someday / note)
- `item_audit_events`
- `source_records`, `source_references` (provenance for every AI-created item)
- `email_threads`, `email_thread_summaries`
- `proposed_actions`
- `email_drafts`, `draft_approvals`
- `reminders`, `reminder_events`
- `daily_briefings`
- `encouragements` (history, to prevent repetition)
- `sync_cursors`, `job_runs`
- `audit_events`

Retention: message bodies are stored as **excerpts with offsets**, not full copies,
except where a feature demonstrably requires the whole body. Raw audio is never stored.

## 6. Honesty rules encoded in the schema

The spec's hardest requirement is that the app must never present an inference as a
fact. This is enforced structurally, not by prompt wording alone:

- Any AI-created item carries a non-null `confidence` and at least one
  `source_reference`. Items failing that constraint cannot be written.
- The UI renders AI-derived claims through a distinct component that requires an
  evidence prop — there is no code path that displays an inference without its source.
- Loose-end copy is drawn from a fixed vocabulary of hedged phrasings; the model
  selects a phrasing, it does not author assertions.

## 7. Testing strategy

- **Unit** — extraction normalization, dedup, prioritization, quiet hours, nudge
  budgets, snooze, escalation. Pure functions, injected clock, no mocks.
- **Integration** — ownership boundaries, adapter contracts, model-output validation,
  approval gates.
- **E2E** (Playwright) — the nine key workflows from the spec.
- **Security** — prompt injection, cross-owner access, send-without-approval.
- **Accessibility** — automated checks on the main flows.

No normal test run touches a paid API: the fake `ModelProvider` returns deterministic
fixtures.

## 8. Toolchain decisions forced during the build

Two came up in Phase 2 and are worth recording, because both look arbitrary
otherwise.

**Biome instead of ESLint.** `typescript-eslint` declares a peer range of
`typescript >=4.8.4 <6.1.0`, so it refuses to load under TypeScript 7 — this
covers the parser too, meaning there is no working ESLint path for TS 7 today.
Rather than downgrade TypeScript, linting moved to Biome, which parses
TypeScript natively with no `typescript` peer dependency. The cost is the ~22
Next.js-specific rules from `@next/eslint-plugin-next`; the gain is Biome's
accessibility rule set, which serves this product's stated a11y requirements
more directly. Type checking is unaffected — `tsc --noEmit` runs on TS 7.

**`npm audit` reports 4 moderate advisories, all unfixable-without-regression.**
The chain is `drizzle-kit` → `@esbuild-kit/esm-loader` → `esbuild <=0.24.2`, and
the advisory concerns esbuild's *dev server* accepting cross-origin requests.
`drizzle-kit` is a devDependency that only emits migration SQL locally and never
serves anything, so the vulnerable code path is not reachable here.
`npm audit fix --force` would downgrade drizzle-kit 0.45 → 0.18.1. Left as-is
deliberately; revisit when drizzle-kit updates its loader.

## 9. Background jobs and the scheduler

Three jobs, matching the three the specification names:

| Job | Interval | Idempotency guarantee |
|---|---|---|
| `email_sync` | 10 min (also on start) | Upserts on `(userId, externalThreadId)` |
| `nudge_round` | 15 min | Gated by the persistence policy's daily budget |
| `daily_briefing` | 60 min | Unique index on `(userId, localDate)` |

Each is safe to run more often than strictly needed, which is what makes a
plain interval acceptable instead of cron semantics. A frequent tick simply
means the policy is consulted more often and usually decides to stay quiet.

The scheduler (`src/server/jobs/scheduler.ts`) gives every job its own timer
and guards against overlap: if a run is still in flight when the next tick
arrives, that tick is **skipped, not queued**. Two concurrent nudge rounds
would each read the same daily budget and could double-spend it.

It is off by default and enabled with `MOMENTUM_ENABLE_SCHEDULER=true`, started
from `instrumentation.ts`. Note that the signal handlers live in a separate
module imported dynamically — referencing `process.once` at the top level of
`instrumentation.ts` makes Turbopack compile it into the Edge bundle, where the
API does not exist, and the build fails.

## 10. Known deferrals

Recorded honestly rather than quietly dropped.

**Written but never executed against a live service:**

- **Microsoft Graph adapter.** Type-checks and is exercised by the demo
  adapter's contract, but has never run against a real mailbox. Response
  shapes come from the API documentation and remain unverified. The OAuth flow
  around it *is* tested — PKCE, CSRF state, token exchange, encrypted storage,
  and disconnect all have coverage using an injected `fetch`.

**Not built:**

- Gmail adapter — interface exists, implementation does not.
- Calendar integration — port defined, no adapter.
- Hosted STT/TTS — browser Web Speech API first; ports allow a later swap.
- Multi-user auth and Postgres — every table carries `userId` and every query
  filters on it, so the port is straightforward, but it is not exercised.
- **Verification of token refresh against a live tenant.** The lifecycle is
  implemented and covered by 25 tests, but every one uses an injected `fetch`.
  Microsoft's real rotation behaviour is unconfirmed.
- **Multi-process refresh locking.** Concurrent renewals are de-duplicated in
  memory (`src/server/integrations/tokens.ts`), which is correct for one
  process. Because Microsoft rotates refresh tokens, two processes renewing at
  once can invalidate each other's token — a database lock would be required
  before running more than one instance.

**Verified by execution:**

- 28 Playwright E2E and axe accessibility checks pass against a production
  build (all nine key workflows, five connection-flow cases, eight routes
  scanned for WCAG 2.1 AA violations).
- The scheduler was run in a real server process: `email_sync` fired on start,
  succeeded, wrote a sync cursor, and upserted 3 threads.
- The colour palette was corrected after axe found `--color-ink-faint` at
  3.12:1. Every foreground token is now computed against the surfaces it sits
  on; see the comment block in `globals.css`.
