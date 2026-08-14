---
name: accessibility-responsive-qa
description: Audit a UI or artifact for accessibility (contrast, focus, labels, reading order, reduced motion) and responsiveness (reflow, touch targets, no horizontal scroll) across breakpoints. Use before shipping UI or an artifact, or when asked to check a11y/WCAG or mobile behavior. Aligns with the project's existing axe + Playwright suites.
---

# Accessibility & Responsive QA

Catch the failures that pixels alone hide. This project already runs axe-core
via Playwright (`e2e/`); this skill is the manual counterpart for artifacts and
in-progress work.

## When to use
- Before shipping a screen or artifact; when asked about WCAG, a11y, or mobile.

## Required inputs
- The artifact path or a running URL, and the target breakpoints (default:
  desktop 1280, tablet 768, mobile 375).

## Workflow
1. Render the target (Browser pane) or, for app routes, use the existing e2e
   setup as the source of truth.
2. **Accessibility tree:** `read_page` — verify one logical heading order,
   labelled controls, meaningful names, and alt/`<title>` on images/SVG.
3. **Contrast:** confirm text ≥ 4.5:1 and UI/large text ≥ 3:1 in BOTH light and
   dark (`resize_window` colorScheme).
4. **Keyboard:** confirm focusable order is logical and focus is visible.
5. **Motion:** confirm animation respects `prefers-reduced-motion`.
6. **Responsive:** at each breakpoint check reflow, no horizontal page scroll,
   touch targets ≥ 24px (prefer 44px), and no clipped/overlapping content.

## Output format
```
A11y/Responsive: PASS | ISSUES
WCAG blocking:
  - <criterion> — <where> — <problem> — <fix>
Responsive issues:
  - <breakpoint> — <problem> — <fix>
Verified: light+dark, breakpoints tested, keyboard, reduced-motion
```

## Quality checks
- Judged from the accessibility tree + computed contrast, not appearance alone.
- Both themes and all target breakpoints actually exercised.

## Safety restrictions
- Read-only audit; propose fixes, never edit.
- For app routes prefer the existing `npm run test:e2e` axe checks over ad-hoc
  claims.

## Examples
- ✅ "Audit docs/artifacts/waiting-dashboard.html for WCAG AA and mobile reflow."
- ✅ "Does ItemCard have a visible focus state and pass contrast in dark mode?"
- ❌ "Make it accessible" with no target → ask what to audit.
