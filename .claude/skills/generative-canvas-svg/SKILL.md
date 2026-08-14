---
name: generative-canvas-svg
description: Create self-contained HTML5 Canvas compositions and standalone SVG artwork (generative/algorithmic art, icons, illustrations, decorative pieces). Use when the user asks for canvas art, an SVG illustration, procedural/generative graphics, or a hand-drawn vector asset. For charts use dataviz; for explanatory diagrams use artifact-diagramming.
---

# Generative Canvas & SVG Artifacts

Produce one self-contained visual file that runs with no network access.

## When to use
- HTML5 Canvas pieces (generative/algorithmic art, particle fields, patterns).
- Standalone SVG artwork (icons, illustrations, decorative marks).
- NOT for: data charts (use `dataviz`), flow/architecture diagrams (use
  `artifact-diagramming`), full UI mockups (use `dashboard-interface-composition`).

## Required inputs
- Subject / intent, target dimensions, theme (Momentum tokens or neutral), and
  any motion/interaction requirement. Ask only if a missing detail changes the
  result materially.

## Workflow
1. Restate the constraints and any assumptions in one line.
2. Choose the medium: **SVG** for crisp scalable vector marks; **Canvas** for
   many elements, pixel effects, or animation.
3. Build one self-contained file:
   - SVG: include `viewBox`, `role="img"`, and a `<title>`. No external hrefs.
   - Canvas: inline `<script>`; seed any randomness deterministically so output
     is reproducible; guard animation with `prefers-reduced-motion`.
   - Colors via CSS variables; inline Momentum tokens when matching the app.
4. Write to `docs/artifacts/<name>.html` (or `.svg`).
5. Hand off to `visual-render-review` for a rendered check.

## Output format
A single `.html` or `.svg` file + a short note: what it depicts, dimensions,
whether it animates, and the seed (if generative).

## Quality checks
- Opens standalone with no console errors and no network requests.
- Scales without clipping; respects `prefers-reduced-motion`.
- Any text meets 4.5:1 contrast.

## Safety restrictions
- No remote assets, CDNs, fonts, or fetches. No npm dependencies.
- No secrets or real personal data — placeholders only.

## Examples
- ✅ "A calm generative dawn gradient with drifting particles, 1200×630, Momentum
  palette, respects reduced motion."
- ✅ "An SVG line-art icon of a compass, 48×48, currentColor."
- ❌ "A bar chart of Q4 revenue" → use `dataviz`.
- ❌ "An auth-flow diagram" → use `artifact-diagramming`.
