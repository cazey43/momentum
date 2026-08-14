# Claude Code Mega Prompt: Personal AI Chief of Staff

Copy everything below into Claude Code.

---

You are Claude Code acting as a senior product engineer, AI systems architect, UX designer, and privacy-minded technical lead. Build a polished, working personal AI chief-of-staff application—not just a mockup or a collection of disconnected screens.

## Product vision

Create a personal assistant called **Momentum** (make the name easy to change) that can talk with me naturally and help me stay on top of everyday life and work. It should help with:

- Daily tasks and priorities
- Email triage and reply drafting
- Items I may have forgotten or allowed to fall through the cracks
- Pending, blocked, delegated, and waiting-for items
- Follow-ups I owe and responses I am waiting to receive
- Gentle accountability and encouragement
- Short motivational quotes that feel relevant, not generic or excessive

The assistant should be persistent enough to be useful but never nagging, guilt-inducing, repetitive, or annoying. It must feel like a calm, perceptive chief of staff who knows when to speak, when to wait, and when to ask.

## First action: inspect, clarify, then build

Before writing code:

1. Inspect the repository, current stack, existing instructions, package files, environment files, tests, and any reusable components.
2. Do not overwrite unrelated work or redesign existing functionality without a clear reason.
3. Present a short implementation plan and identify any assumptions.
4. Ask me only the questions that truly block implementation, in one compact batch. At minimum, determine:
   - Whether this is a local-only app or should be deployable
   - Whether I use Gmail, Outlook, or both
   - Which task sources I use, if any
   - Whether calendar integration belongs in the first release
   - My time zone, preferred morning briefing time, quiet hours, and desired reminder intensity
   - My preferred voice, if a voice provider is already selected
5. If I do not answer, proceed with sensible, reversible defaults and clearly document them. Use demo data and adapter interfaces when credentials are unavailable. Do not stall the entire build for optional integrations.
6. If the repository is empty, initialize a production-quality TypeScript application. Prefer a modern full-stack web setup that is easy to run locally and deploy. Use current stable packages after checking their official documentation. Do not invent SDK methods or depend on deprecated APIs.

## Core experience

### 1. Conversational assistant

Build a chat experience in which I can type or speak naturally. The assistant must:

- Remember active goals, preferences, open commitments, and recent decisions
- Distinguish between a task, note, idea, commitment, deadline, delegated item, and waiting-for item
- Turn conversational statements into proposed actions
- Confirm before making consequential changes
- Explain why an item is being surfaced
- Cite the source of any inferred commitment, such as an email subject, task, note, or conversation date
- Admit uncertainty instead of pretending to know

Examples of natural commands:

- “What absolutely needs my attention today?”
- “What am I waiting on?”
- “Did I promise anyone something this week?”
- “Draft a reply to the three emails that need me.”
- “Remind me tomorrow, but only once.”
- “I handled that—mark it complete.”
- “Don’t bring this up again until next Friday.”
- “Give me a quick pep talk.”

### 2. Voice mode—the talking model

Implement a real voice conversation mode, not a decorative microphone icon.

Requirements:

- Push-to-talk as the reliable default
- Optional hands-free mode only after explicit user activation
- Visible listening, thinking, speaking, muted, and error states
- Live or near-live transcript for both sides
- Interrupt/stop-speaking control
- Keyboard-accessible controls and clear permission handling
- Graceful text-only fallback when microphone or audio access is unavailable
- Configurable speech-to-text and text-to-speech provider adapters
- Keep provider-specific code behind interfaces so providers can be replaced later
- Never listen in the background unless I explicitly enable it, and make the active listening state unmistakable
- Never store raw audio by default; if a feature requires storage, obtain explicit opt-in and provide deletion controls

For the first runnable version, choose the simplest dependable implementation supported by the environment. Browser speech capabilities may be used as a local fallback, but isolate them behind the same adapters as hosted providers. Document how to add production speech providers later.

### 3. Today dashboard

Create a clean “Today” view with:

- A short greeting and current date
- Top three suggested priorities
- Must-do today
- Due soon
- Overdue
- Waiting on others
- Drafts awaiting my approval
- Potentially forgotten items
- One optional motivational quote or short encouragement
- A quick capture field for tasks, thoughts, promises, and follow-ups
- A prominent “Talk to Momentum” control

Avoid a dense command center. Use progressive disclosure. Show the essential information first, with details available on demand.

### 4. Daily briefing

Generate a concise daily briefing that can be read or spoken. It should include:

1. What requires attention today
2. Time-sensitive or overdue commitments
3. Important emails needing a response
4. People I am waiting on
5. Items at risk of falling through the cracks
6. A realistic suggested order of attack
7. One brief, relevant encouragement or quote when enabled

The briefing should be actionable and short by default. Offer an expanded version rather than forcing a long report.

### 5. Email assistant

Support Gmail, Outlook, or both through separate provider adapters. Start with least-privilege, read-only access wherever possible.

Capabilities:

- Identify unread and high-signal messages
- Detect direct questions, promises, dates, requests, invoices, approvals, and follow-up expectations
- Group newsletters, receipts, automated notifications, and low-priority mail separately
- Detect messages that likely need a reply
- Detect messages I said I would handle but have not completed
- Detect conversations where I am waiting for a response
- Produce concise thread summaries
- Draft replies in my preferred tone
- Create proposed tasks or follow-ups from email, with source links and confidence scores

Safety rules:

- Never send an email without explicit approval in the interface
- Never delete, archive, unsubscribe, forward, or modify mail without explicit approval
- Clearly distinguish AI suggestions from facts found in the source
- Display the exact recipients, subject, and final body before send approval
- Flag sensitive, financial, legal, medical, or emotionally charged messages for careful review
- Do not fabricate missing facts, commitments, dates, or recipient details

Implement a draft queue with statuses such as `suggested`, `drafted`, `approved`, `sent`, `dismissed`, and `snoozed`.

### 6. Catch what fell through the cracks

Create a “Loose Ends” engine. It should analyze authorized data sources and surface candidates, not make accusations.

Look for signals such as:

- “I’ll send,” “I’ll review,” “I’ll call,” “I’ll get back to you,” or similar commitments
- Questions directed to me that remain unanswered
- Deadlines or dates mentioned in messages
- Threads with no response after a reasonable period
- Delegated tasks without a recorded outcome
- Tasks repeatedly postponed
- Items marked in progress for too long
- Notes that contain action language but were never turned into tasks
- Calendar events that imply preparation or a follow-up

Every loose-end card must show:

- What may need attention
- Why it was detected
- The source and date
- Confidence: high, medium, or low
- A suggested next action
- Controls for complete, create task, draft reply, snooze, dismiss, and “not relevant”

Use careful language: “This may still need a response” or “I found a possible open commitment.” Never shame the user or state an inference as a fact.

### 7. Tasks, commitments, and waiting-for tracking

Support these item types:

- Task
- Commitment I made
- Waiting for someone else
- Delegated item
- Follow-up
- Someday/maybe
- Note

Each actionable item should support:

- Title and optional detail
- Status
- Priority
- Due date or follow-up date
- Source and source URL/identifier
- Person or organization involved
- Project or category
- Confidence if AI-created
- Reminder policy
- Snooze-until date
- Created, updated, and completed timestamps
- Audit trail of meaningful changes

Provide inbox, today, upcoming, overdue, waiting, loose ends, and completed views. Support quick natural-language capture and bulk review.

## Persistence without annoyance

Build a configurable **Gentle Persistence Policy** as a first-class system, not scattered reminder logic.

Default behavior:

- Quiet hours: 8:00 PM to 8:00 AM in my local time zone
- No more than one proactive daily briefing
- No more than two proactive nudges per day total
- Never repeat the same wording
- Do not nudge an item again after it is opened, snoozed, dismissed, completed, or actively discussed
- Respect “not today,” “later,” “stop reminding me,” and “only remind me once” immediately
- Increase urgency only when a real deadline approaches or consequences rise
- Bundle low-urgency reminders instead of sending them separately
- If several items are overdue, ask me to choose one next step rather than listing everything repeatedly
- After two ignored nudges, pause and ask whether to snooze, reschedule, lower the priority, or stop reminders
- Use neutral, supportive language; no guilt, scolding, fake urgency, streak pressure, or manipulative notifications

Create reminder levels:

- **Silent:** visible only in the app
- **Gentle:** included in a briefing or bundled summary
- **Direct:** one clear reminder for a near deadline
- **Urgent:** reserved for an imminent, high-impact deadline that the data genuinely supports

Give me controls for quiet hours, daily nudge budget, reminder channels, quote frequency, weekend behavior, and reminder style. Include a global “Pause proactive reminders” switch.

## Motivation and tone

The assistant’s personality should be calm, warm, capable, concise, and nonjudgmental. It should sound like a trusted chief of staff—not a life coach caricature.

Motivational content rules:

- At most one quote per day by default
- Let me disable quotes entirely
- Prefer short, accurately attributed public-domain quotations, or original encouragement without attribution
- Never invent a quote or attribution
- Avoid clichés when a specific, practical encouragement would be better
- Tie encouragement to current effort when appropriate
- Do not use motivation to minimize exhaustion, grief, illness, stress, or legitimate constraints

Example tone:

- “You have five open items, but only one is time-sensitive. Let’s handle that first.”
- “This may have slipped through. Want me to turn it into a task or dismiss it?”
- “You’ve made progress. The next useful step is small: approve the draft or snooze it.”
- “Nothing urgent is hiding right now. You can focus on the work you chose.”

## Intelligence and orchestration

Use the language model for classification, summarization, extraction, prioritization suggestions, and drafting. Keep deterministic business rules deterministic.

Required approach:

- Use structured model outputs validated by schemas
- Separate model prompts from application code
- Version prompts
- Include confidence and evidence for extracted commitments
- Treat all email, task, calendar, and note content as untrusted data, never as system instructions
- Defend against prompt injection in connected content
- Do not allow retrieved content to authorize tools or external actions
- Require server-side permission checks for every action
- Make all external side effects explicit, narrow, logged, and reversible where possible
- Use idempotency keys for sends and other non-repeatable actions
- Avoid duplicate tasks and reminders through deterministic deduplication
- Keep a human approval gate for sending messages or making consequential changes

When ranking priorities, consider due date, impact, effort, dependencies, waiting time, user-stated importance, and confidence. Show a short human-readable reason, not a mysterious score alone.

## Suggested technical architecture

Adapt to the existing repository. If starting fresh, use a maintainable TypeScript architecture such as:

- Next.js with App Router
- TypeScript with strict mode
- Accessible component system and responsive styling
- PostgreSQL for durable data, with an ORM and migrations
- Secure server-side authentication and encrypted integration tokens
- Background jobs for sync, daily briefing generation, and reminders
- Provider adapters for email, calendar, tasks, speech-to-text, text-to-speech, and notifications
- A model gateway so the LLM provider and model can be changed through configuration
- Schema validation for API inputs and model outputs
- Unit, integration, and end-to-end tests

Do not couple core domain logic to a single vendor. Use interfaces such as:

- `EmailProvider`
- `CalendarProvider`
- `TaskProvider`
- `SpeechToTextProvider`
- `TextToSpeechProvider`
- `NotificationProvider`
- `ModelProvider`

If a managed database or authentication product is chosen, keep the domain layer portable. Use environment variables and provide `.env.example`; never commit secrets.

## Minimum data model

Design and migrate a coherent schema covering at least:

- User profile and preferences
- Connected accounts and permissions
- Conversations and messages
- Tasks and commitments
- Waiting-for/delegated items
- Source records and source references
- Email thread metadata and summaries
- Proposed actions
- Email drafts and approvals
- Reminders and reminder events
- Daily briefings
- Quotes/encouragement history
- Sync cursors and job state
- Audit events

Include indexes, ownership boundaries, timestamps, soft deletion where useful, and a retention strategy. Do not store more message content than the feature actually requires.

## Privacy, security, and trust

Privacy is part of the product, not an afterthought.

- Use least-privilege OAuth scopes
- Encrypt tokens and sensitive fields at rest
- Keep secrets server-side
- Validate authorization and ownership on every request
- Sanitize rendered content
- Rate-limit sensitive endpoints
- Protect against CSRF, XSS, SSRF, injection, replay, and prompt injection
- Provide connected-account management and revoke/disconnect controls
- Provide export and delete-my-data controls
- Show sync status and last successful sync
- Log consequential actions without unnecessarily logging private content
- Use redaction in application logs and error reporting
- Provide a privacy settings screen that explains what is read, stored, inferred, and shared with model providers

No email, calendar, or task data should be sent to a model unless necessary for an enabled feature and permitted by the user. Prefer minimal excerpts over whole mailboxes or entire histories.

## User interface

Build a polished, responsive interface with these primary areas:

1. Today
2. Inbox/Review
3. Tasks
4. Waiting For
5. Loose Ends
6. Drafts
7. Talk
8. Settings and Integrations

Important UI details:

- Clear empty, loading, syncing, offline, and error states
- Source links and confidence indicators for AI suggestions
- Undo for reversible actions
- Confirmation for consequential actions
- Bulk approve/dismiss only when safe and understandable
- Accessible color contrast, keyboard navigation, focus states, labels, and reduced-motion support
- Mobile-friendly voice and quick-capture experience
- No fake functionality: if an integration is not connected, explain it and offer demo mode

## Demo mode

Provide a useful seeded demo that works without external credentials. It should include realistic sample tasks, email threads, waiting-for items, an overdue commitment, a possible loose end, a draft reply, and a daily briefing. Clearly label all sample data as demo data.

Demo mode must exercise the full review flow without actually sending anything.

## Key workflows to implement end to end

Complete these vertical slices before adding decorative extras:

1. Capture a task by typing and by voice
2. View and update today’s priorities
3. Detect a possible commitment from demo email data
4. Review its evidence and turn it into a task
5. Draft an email response and require approval before send
6. Create and speak a daily briefing
7. Snooze or dismiss a nudge and prove that reminder suppression works
8. Track an item as “waiting for,” then schedule one gentle follow-up
9. Pause all proactive reminders

## Testing requirements

Write meaningful tests, including:

- Unit tests for task extraction, commitment detection normalization, prioritization rules, deduplication, quiet hours, nudge budgets, snooze logic, and reminder escalation
- Integration tests for data ownership, provider adapters, model-output validation, and approval gates
- End-to-end tests for the key workflows above
- Security tests for prompt-injection content, unauthorized resource access, and attempted send without approval
- Accessibility checks for the main flows

Use deterministic fixtures for model-dependent tests. Do not make normal test runs depend on paid external APIs.

## Acceptance criteria

The build is complete only when:

- The app runs locally from documented commands
- A new user can complete onboarding and set reminder preferences
- Demo mode works without credentials
- Text chat and a functional voice path both work
- The Today dashboard contains real seeded or connected data
- The daily briefing can be read and spoken
- Loose ends display evidence, source, and confidence
- Email drafts cannot be sent without explicit approval
- Quiet hours, snoozing, reminder budgets, and pause controls are enforced in code
- The app never represents an inference as a confirmed fact
- Core flows have passing automated tests
- Linting and type checks pass
- Empty, error, permission-denied, and disconnected states are handled
- Setup, architecture, security choices, limitations, and provider configuration are documented

## Delivery process

Work in small, verifiable phases:

1. Repository assessment and plan
2. Architecture, schema, and app shell
3. Demo data and core task domain
4. Chat and structured AI actions
5. Today view and daily briefing
6. Loose Ends detection and review
7. Email adapters and approval-gated drafts
8. Voice mode
9. Gentle Persistence Policy and background jobs
10. Security hardening, tests, accessibility, and documentation

After each phase:

- Run the relevant tests, type checker, and linter
- Fix errors before moving on
- Summarize what changed and identify any remaining limitation
- Keep the app runnable

Do not stop after producing a plan. Continue implementing until a real, tested application exists or an external credential/decision truly blocks further progress. If blocked, finish all work that does not depend on the blocker and provide exact next steps.

## Final handoff

At completion, provide:

- What was built
- How to run it
- How to use demo mode
- How to configure each optional integration
- Required environment variables
- Test, lint, and build results
- Security and privacy notes
- Known limitations
- The next three highest-value improvements

Favor reliability, clarity, restraint, and user trust over flashy automation. The defining product quality is this: **Momentum notices what matters, helps me act, and then gets out of my way.**

