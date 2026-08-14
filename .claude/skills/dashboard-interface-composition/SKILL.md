---
name: dashboard-interface-composition
description: Compose polished dashboards and interface prototypes (layouts, stat tiles, panels, nav, forms) as self-contained responsive HTML. Use when the user asks for a dashboard, admin panel, UI mockup, screen prototype, or landing composition. Pulls Momentum's design tokens when the artifact should match the app; defers chart internals to dataviz and page-level design polish to artifact-design.
---

# Dashboard & Interface Composition

Assemble interface layouts that are responsive, accessible, and on-brand.

## When to use
- Dashboards, admin panels, settings screens, forms, landing sections.
- Interface prototypes for review before implementation.
- NOT for: single charts (`dataviz`), pure artwork (`generative-canvas-svg`),
  or editing the real app (that is application work, not an artifact).

## Required inputs
- Purpose and primary action of the screen, the key content blocks, target
  breakpoints, and theme (Momentum tokens vs. neutral).

## Workflow
1. State the user goal and the ONE primary action; everything else is secondary.
2. If matching Momentum, read `src/app/globals.css` and inline its OKLCH tokens;
   consult `artifact-design` for page-level layout/type polish.
3. Lay out with CSS grid/flex; define a clear visual hierarchy; use
   progressive disclosure (don't put everything on screen).
4. Include realistic but obviously-fake placeholder data.
5. Provide every state that applies: loading, empty, populated, error.
6. Write to `docs/artifacts/<name>.html`; hand off to `visual-render-review`
   and `accessibility-responsive-qa`.

## Output format
One self-contained responsive `.html` file + a short note describing the screen,
its primary action, the states included, and the breakpoints handled.

## Quality checks
- One obvious primary action; secondary actions clearly subordinate.
- No horizontal page scroll at any width; wide tables scroll in their own box.
- Light and dark both legible; text ≥ 4.5:1.
- Empty and error states present, not just the happy path.

## Safety restrictions
- Self-contained: no CDNs, remote fonts, or network calls; no dependencies.
- Never embed real user data, secrets, or private MCP content — placeholders only.

## Examples
- ✅ "A Momentum-styled 'Waiting For' dashboard with stat tiles, a filterable
  list, and an empty state, responsive to mobile."
- ❌ "Add a dashboard route to the Next app" → that's app work, not an artifact.
