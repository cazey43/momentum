---
name: visual-render-review
description: Render a visual artifact in the browser, screenshot it, and run a bounded critique-and-revise loop (max 3 iterations) against acceptance criteria. Use after creating or editing any HTML/SVG/canvas artifact to verify it actually looks right before shipping. Drives the in-app Browser tools and the visual-qa-critic agent.
---

# Visual Rendering & Screenshot Review

Close the multimodal loop: what was built is checked against what was asked.

## When to use
- Immediately after `generative-canvas-svg`, `dashboard-interface-composition`,
  or any artifact edit, before declaring it done.

## Required inputs
- Artifact file path and the acceptance criteria (explicit visual constraints).
  For a revision, also the path/copy of the immediately preceding version.

## Workflow (bounded — max 3 iterations)
1. **Lock the source.** For edits, snapshot the current file as the authoritative
   original and start a change log.
2. **Render.** Open the artifact in the Browser pane
   (`mcp__Claude_Browser__navigate` to a `file://` path, or `preview_start` for a
   served page).
3. **Capture.** Screenshot at desktop width, then `resize_window` to ~375px and
   screenshot again. Read the accessibility tree with `read_page`.
4. **Critique.** Dispatch the `visual-qa-critic` agent with the screenshots,
   source, and criteria. It returns PASS / REVISE / ESCALATE + findings.
5. **Revise once.** Convert findings into specific corrections and apply exactly
   one controlled revision (preserve unaffected regions; append to the change log).
6. **Re-render & re-check.** Repeat from step 2.
7. **Stop** when the critic returns PASS, or after 3 iterations → ESCALATE the
   remaining findings to the human. Never loop indefinitely.

## Output format
```
Result: PASS after N iteration(s) | ESCALATED
Change log:
  - v1 → v2: <what changed and why>
Remaining (if escalated): <open findings for the human>
Screens verified: desktop, mobile(375px)
```

## Quality checks
- Both widths captured; accessibility tree read (not pixels alone).
- Each revision validated against the immediately preceding version.
- "Refresh" never interpreted as license to redesign.

## Safety restrictions
- Only render local artifacts or explicitly-provided URLs.
- Never commit or publish the artifact as part of this loop — that is a separate,
  human-approved step.

## Examples
- ✅ "Render docs/artifacts/waiting-dashboard.html and run the review loop against
  these criteria: primary action obvious, mobile-safe, dark-mode legible."
- ❌ "Keep iterating until it's perfect" → capped at 3, then escalate.
