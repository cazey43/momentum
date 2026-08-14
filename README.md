# Momentum

A personal AI chief of staff. It notices what matters, helps you act, and then
gets out of the way.

Momentum is **local-first and single-user**. Your tasks, commitments, and mail
excerpts live in a SQLite file in this folder. Nothing leaves the machine unless
you connect an account and configure a model key.

---

## Running it

```bash
npm install
cp .env.example .env.local      # then fill in the values you want
npm run db:migrate              # create the local database
npm run db:seed                 # load the labelled demo dataset
npm run dev                     # http://localhost:3000
```

That is enough to use the whole app. **No credentials are required** — with no
API key and no mailbox connected, Momentum runs in demo mode with a
deterministic assistant, and says so in the interface rather than pretending.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm run start` | Production build and serve |
| `npm run verify` | Typecheck, lint, and unit/integration tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `npm run lint:fix` | Biome |
| `npm test` | Vitest (unit + integration) |
| `npm run test:e2e` | Playwright E2E + accessibility (see below) |
| `node scripts/inspect-jobs.mjs` | Show recent background-job activity |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Reset and reload demo data |

### End-to-end and accessibility tests

One-time browser download (~115 MB, into `.playwright-browsers/` inside this
project rather than a machine-level cache):

```bash
npx playwright install chromium
npm run test:e2e
```

The suite migrates, seeds, builds, and serves the app, then runs 28 checks: the
nine key workflows, five account-connection cases, and axe WCAG 2.1 AA scans of
all eight routes.

---

## Background jobs

Off by default. To run them:

```bash
MOMENTUM_ENABLE_SCHEDULER=true npm run start
```

| Job | Interval |
|---|---|
| `email_sync` | every 10 minutes, and once on start |
| `nudge_round` | every 15 minutes |
| `daily_briefing` | every hour |

Frequent ticks are cheap: the Gentle Persistence Policy decides whether
anything is actually delivered, and usually decides to stay quiet. Every job is
idempotent, and the scheduler skips a tick if the previous run of that job is
still going.

Without the flag, the same jobs can be triggered by hand from Settings.

---

## Demo mode

Demo mode is on by default (`MOMENTUM_DEMO_MODE=true`). Every seeded row is
marked `isDemo` and labelled **Demo data** in the interface.

The dataset is built to exercise the full review flow without sending anything:

- An **overdue commitment** you made in writing, with the sentence that proves it
- Someone who has **gone quiet** on a question they asked you
- A **delegated item** with no recorded outcome
- A **low-confidence loose end** that openly says it might be wrong
- A **draft reply** waiting on your approval, flagged as financially sensitive
- A **daily briefing**, a snoozed item, and a completed item

Demo mode stops exactly where a real send would happen. The demo mailbox does
not implement sending at all, so the send path refuses at the type level.

---

## Configuring the optional integrations

### Model provider (Anthropic)

Add to `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
MOMENTUM_MODEL=claude-opus-5
MOMENTUM_MODEL_EFFORT=medium
```

Without a key, the deterministic provider handles everything. It understands a
few phrasings (`I handled that`, `remind me tomorrow`, `stop reminding me`) and
tells you plainly what it cannot do. Force it at any time with
`MOMENTUM_MODEL_PROVIDER=fake`.

### Outlook / Microsoft 365

The connection flow is built and tested. **It has never been run against a real
mailbox** — the Graph response shapes are still unverified.

1. Register an application at [entra.microsoft.com](https://entra.microsoft.com)
   → App registrations.
2. Redirect URI (Web): `http://localhost:3000/api/integrations/microsoft/callback`
3. Delegated permissions — **read-only, by design**:
   `offline_access`, `User.Read`, `Mail.Read`, `MailboxSettings.Read`
4. Put `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_SECRET`,
   `MS_GRAPH_REDIRECT_URI` and `MOMENTUM_ENCRYPTION_KEY` in `.env.local`.
5. Restart, then Settings → **Connect Outlook**.

Settings shows a precise checklist of anything missing, so a half-configured
integration is visible before you are bounced to a Microsoft error page.

What the flow guarantees:

- **PKCE (S256)** — the verifier never leaves this server, so an intercepted
  authorization code cannot be redeemed by anyone else.
- **CSRF state** — a random value round-trips through the redirect in an
  httpOnly cookie and is compared on return. A forged callback is refused.
- **Scope overreach is rejected** — if the tenant grants `Mail.Send` or any
  write scope, the connection is refused rather than stored.
- **Encryption is checked before the token is fetched**, so a token can never
  exist with nowhere safe to put it.
- **Disconnect destroys credentials** — both tokens are overwritten with null
  and synced mail metadata is deleted. It cannot revoke access at Microsoft's
  end; the UI says so instead of implying otherwise.

**Token renewal** happens automatically. Access tokens last about an hour and
are renewed five minutes before expiry, so a request never races the deadline.
Three details that matter:

- Microsoft **rotates refresh tokens**; the new one is persisted on every
  renewal. Not doing so is the classic way this breaks, silently, an hour later.
- Concurrent renewals are **de-duplicated per account**. Because rotation
  invalidates the previous token, two parallel refreshes can invalidate each
  other's result.
- A **dead grant** (password changed, consent withdrawn) clears the stored
  credentials and Settings shows a *Reconnect* prompt. A **network blip** does
  not — credentials survive and the next attempt retries.

Momentum never requests `Mail.Send`, `Mail.ReadWrite`, or any delete
permission. The read-only provider class does not implement `sendReply`, so
even an approved draft cannot be sent through it.

### Voice (optional)

Momentum can use hosted speech instead of the browser's built-in engine.
[Deepgram](https://console.deepgram.com) handles speech-to-text and
[ElevenLabs](https://elevenlabs.io) handles text-to-speech. The keys are read
server-side and slot in behind the same speech ports. When any of them is
missing, voice **falls back to the browser Web Speech API** — the existing
behavior — so this is purely additive.

Add to `.env.local`:

```
DEEPGRAM_API_KEY=            # console.deepgram.com → API Keys
ELEVENLABS_API_KEY=          # elevenlabs.io → Profile → API Keys
ELEVENLABS_VOICE_ID=         # elevenlabs.io → Voices (the id, not the name)
ELEVENLABS_MODEL_ID=         # optional, defaults to eleven_turbo_v2_5
```

### Encryption key

Required before connecting any account:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set it as `MOMENTUM_ENCRYPTION_KEY`. Tokens are stored AES-256-GCM encrypted;
the key never enters the database.

---

## How it is put together

```
src/
  core/        Pure domain logic. No I/O, no vendor SDKs, no clock reads.
    domain/    Item vocabulary, buckets, state transitions, dedup
    policy/    The Gentle Persistence Policy
    priority/  Ranking, with the human-readable reason as an output
    looseends/ Structural detection rules
    ports/     EmailProvider, ModelProvider, speech providers
    time/      The injected Clock
  adapters/    Every vendor lives here and nowhere else
  prompts/     Versioned prompts, kept out of application code
  server/      Session, auth checks, AI gateway, jobs, crypto, rate limits
  db/          Drizzle schema, migrations, repositories
  app/         Next.js App Router
```

The rule that keeps it honest: **`core/` never imports a vendor SDK, never
reads the clock, and never touches the database.** That is what makes quiet
hours, nudge budgets, snooze logic, and prioritization testable as pure
functions — 179 of the tests need no mocks at all.

Full detail, including the decisions taken along the way, is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Privacy and safety

These are properties of the code, not promises in a document:

- **Nothing sends without approval.** Three independent conditions are checked
  at send time: a recorded approval row exists, its content hash still matches
  the draft, and the provider can send at all. Editing a draft after approving
  it invalidates the approval. Nine tests cover this.
- **No inference is presented as fact.** A database CHECK constraint refuses to
  store an AI-created item without a confidence level and a plain-language
  reason. The repository additionally refuses one with no cited source. The UI
  renders inferences through a component that requires evidence as a prop.
- **Retrieved content is data, never instructions.** Email bodies are fenced
  with a per-request random nonce, the model can only reply in a fixed schema,
  and it can only ever *propose* — execution re-checks ownership server-side.
- **Least privilege.** Read-only scopes; no delete, archive, or unsubscribe
  capability exists anywhere in the email port.
- **No raw audio.** The speech ports have no way to surface an audio blob, so
  none can be stored.
- **Quiet by default.** Quiet hours 20:00–08:00, two nudges a day, weekends
  off, and a global pause switch.

---

## Known limitations

Stated plainly rather than buried:

- **The Graph adapter has never run against a real mailbox.** Response shapes
  are written from the API docs and are unverified. The OAuth flow around it is
  tested with an injected `fetch`, but that proves the plumbing, not Microsoft's
  actual payloads.
- **Token refresh is implemented and unit-tested, but never exercised against
  real Microsoft responses** — like the adapter itself, it is verified with an
  injected `fetch`, not a live tenant.
- **Single-process refresh locking.** De-duplication is in-memory, which is
  correct for this single-process app. A multi-process deployment would need a
  database lock, because refresh-token rotation makes concurrent renewal a
  correctness problem rather than merely wasteful.
- **No Gmail adapter.** The port exists; the implementation does not.
- **No calendar integration.** Deferred out of the first release.
- **Voice uses the browser Web Speech API.** Availability varies by browser,
  and in some browsers recognition sends audio to a vendor service — the UI
  discloses this. Hosted STT/TTS would slot in behind the same ports.
- **`npm audit` reports 4 moderate advisories** in `drizzle-kit`'s dev-only
  esbuild dependency. Not reachable in this app; the fix would downgrade
  drizzle-kit by 27 minor versions. See `docs/ARCHITECTURE.md` §8.
- **Single user.** Every table carries `userId` and every query filters on it,
  so the port is straightforward, but multi-user auth is not built.

## The next three things worth doing

1. **Connect a real mailbox and verify the Graph adapter** against a dedicated
   test account, then run the sync job for a week to see how detection behaves
   on genuine mail. Everything downstream of the adapter is guesswork until
   this happens.
2. **Add a Gmail adapter**, now the single biggest coverage gap — the provider
   port, connection flow, and token lifecycle are all in place around it.
3. **Replace in-memory refresh de-duplication with a database lock** if this
   ever runs as more than one process.
