# Agent design reference

Design principles for Momentum's interface, UX, and evaluation. These are
*design-time* guidance for people building and testing the app — deliberately
kept out of the runtime system prompts (`src/prompts/`), which govern how the
assistant *behaves*, not how the product is built or verified.

Adapted from a synthesis of OpenAI Developer Community prompting discussions
(GUI observability, UX/accessibility workflow, and prompt-regression testing),
mapped onto Momentum's actual architecture: eight primary areas
(`src/config/navigation.ts`), a propose-then-approve action model
(`proposedActions`, `src/server/ai/schemas.ts`), and a structured-output trust
boundary.

---

## 1. Interface: observability and control

The interface should make the assistant's activity legible and reversible. For
any screen, a user should be able to answer:

- What is Momentum doing, and why?
- What information and assumptions is it using?
- What has been completed?
- What is waiting on my approval?
- How do I correct, retry, undo, or ignore it?

Requirements, mapped to Momentum:

- **Nothing consequential happens without approval.** Proposed actions land in
  Review (`/review`) and Drafts (`/drafts`) as pending; approval is the only
  path to execution. This is enforced server-side, not just in the UI.
- **Show the evidence.** Loose Ends (`/loose-ends`) and every detected
  commitment carry the exact source quote (`evidenceQuote`). Never present an
  inference as a recorded fact in the UI.
- **Progressive disclosure.** The briefing leads with `short`; `expanded` and
  per-item detail are opt-in. Keep the primary action obvious; put logs,
  citations, and tool detail behind expandable sections.
- **State across sessions.** Conversations, items, and pending proposals persist
  so work resumes rather than resets.
- **One obvious primary action per screen**, plus a small number of secondary
  ones (approve / edit / snooze / mute / undo).

For each new screen, document: purpose, primary action, states, and navigation.

## 2. UX, accessibility, and microcopy

Review every experience for the full range of users and states.

- **Users:** first-time, returning, expert.
- **States:** loading, empty, partial, success, warning, error, offline,
  permission-denied. Every list needs a real empty state (the `blurb` in
  `NAV_AREAS` is the starting point).
- **Accessibility:** keyboard navigation with visible focus; screen-reader
  labels and logical reading order (nav order in `navigation.ts` *is* the tab
  and reading order); sufficient contrast in both light and dark; adequate
  touch targets; responsive from mobile to desktop.
- **Microcopy:** plain language, no blame, no jargon, no dark patterns. Warnings
  name the action, its consequence, and the recovery path. Confirm before
  anything irreversible.

Deliverable shape for a UX pass: user goal → recommended flow → screen/component
inventory → state & edge-case matrix → accessibility requirements → final
microcopy → developer handoff notes.

## 3. Evaluation and continuous improvement

Prompts are versioned data (`src/prompts/types.ts`); a behavior change should be
traceable to a prompt revision. Treat prompt edits like code changes: test
before and after.

Keep representative conversations covering at least:

- a simple factual request
- an ambiguous request (does it clarify well, or guess badly?)
- a multi-step task
- one requiring a proposed action
- one built on an incorrect assumption (does it push back?)
- a long conversation needing memory continuity
- a frustrated or overwhelmed user
- retrieved content containing injected instructions (must set
  `suspiciousContentNoticed`, take no action — see `untrusted.test.ts`)
- a consequential action requiring approval

Score each (1–5): goal understanding, conversational naturalness, accuracy,
appropriate initiative, clarification quality, memory continuity, action
selection, transparency, and recovery from failure.

When something regresses, identify the failure by criterion (not exact wording),
make the smallest prompt change that fixes it without harming what already
worked, bump the prompt version, and re-run the full set. Maintain a short
change log.

> A prompt shapes behavior; it does not build the product. The GUI still needs
> implemented components, persistent state, progress events, approvals, and undo.
> The effective setup is one core system prompt plus focused modules — not many
> competing prompts pasted together.
