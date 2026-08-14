---
name: frontend-design
description: Use when building or restyling user interface. Requires a clear visual concept, reuse of the existing design system, complete states, WCAG AA accessibility, responsive behavior, and visual browser verification.
allowed-tools: [Read, Grep, Glob, Edit, Write]
---

# Frontend Design

Ship interfaces that look intentional, not generated.

## Requirements
- A clear **visual concept** appropriate to the product and audience.
- **Reuse the existing design system** (tokens, components) before adding primitives.
- Intentional **typography, spacing, hierarchy, color, and interaction states**.
- **Responsive** at mobile (~390px), tablet (~768px), and desktop (~1440px).
- **Accessibility**: WCAG AA contrast, keyboard access, visible focus, semantic
  HTML, and `prefers-reduced-motion` support.
- **Complete states**: loading, empty, success, warning, validation, error.

## Decision gates
- Introducing a new primitive? First prove the design system cannot express it.
- Adding a gradient/glass/animation/card? Justify it or cut it.

## Stopping conditions
- All states implemented, responsive at all three widths, a11y checks pass, and
  the result has been **visually verified in a browser**.

## Anti-overengineering rules
- Restraint with gradients, glassmorphism, nested cards, oversized headings,
  decorative animation, and fake metrics.

## Expected output
The implemented UI, the states covered, and a note on the visual verification.
