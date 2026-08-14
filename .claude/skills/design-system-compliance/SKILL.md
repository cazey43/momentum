---
name: design-system-compliance
description: Check that UI code or a visual artifact conforms to Momentum's design system — OKLCH tokens, contrast rules, spacing/radius scale, and dark-mode parity — and report violations with fixes. Use before/after building UI, when reviewing a component, or when asked "is this on-brand / accessible / using the right tokens".
---

# Design-System Compliance

Momentum's tokens are the single source of truth. This skill finds drift.

## When to use
- Reviewing a new/changed component or a generated artifact for brand + a11y fit.
- Auditing for hardcoded colors, off-scale spacing, or missing dark mode.

## Required inputs
- The file(s) or artifact to check. (No input → check the current git diff.)

## Reference
- Tokens: `src/app/globals.css` `@theme` block (light) + the
  `@media (prefers-color-scheme: dark)` `:root` override.
- Rule: text contrast ≥ 4.5:1; `--color-urgent` is reserved for real time
  pressure; foreground tokens must not be lightened without re-checking contrast.
- Shape/type: `--radius-card`, `--font-sans`.

## Workflow
1. Enumerate the canonical tokens from `globals.css`.
2. Scan the target for:
   - Raw colors: `#hex`, `rgb(`, `hsl(`, or named CSS colors → must be a token.
   - Spacing/radius values off the established scale.
   - Any element that sets a light-mode color but no dark-mode counterpart.
   - Foreground/background pairings whose contrast may fall below 4.5:1.
3. For each hit, record `file:line → issue → specific token or fix`.
4. Summarize; separate blocking (contrast/accessibility) from stylistic drift.

## Output format
```
Compliance: PASS | ISSUES
Blocking (a11y/contrast):
  - <file:line> — <issue> — <fix>
Token drift:
  - <file:line> — <hardcoded value> — <token to use>
Dark-mode gaps:
  - <file:line> — <missing dark value>
```

## Quality checks
- Every flagged color maps to a real token that exists in `globals.css`.
- Contrast claims are computed against the actual surface, not guessed.

## Safety restrictions
- Read-only analysis. Never edit files; propose fixes for a human/other agent.

## Examples
- ✅ "Check ItemCard.tsx for token compliance and dark-mode parity."
- ✅ "Does this generated dashboard use Momentum tokens and pass contrast?"
- ❌ "Redesign the palette" → escalate; that is a design-direction decision.
