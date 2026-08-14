---
name: reference-image-style-analysis
description: Analyze a reference image (screenshot, mockup, moodboard, inspiration) and extract a concrete, reusable style spec — palette, typography, spacing, shape, motifs — reconciled against Momentum's tokens. Use when the user provides an image and asks to "match this style", "use this as reference", or "what design language is this".
---

# Reference-Image Style Analysis

Turn a picture into an actionable spec — never a pixel-copy of someone's work.

## When to use
- The user supplies a reference image and wants a new artifact/UI to echo it, or
  wants the style described so it can be applied consistently.

## Required inputs
- The reference image (provided to the session so it can be viewed) and what it
  is a reference FOR (an artifact, a screen, a palette).

## Workflow
1. View the image and describe what you actually observe — do not invent details
   you cannot see.
2. Extract, concretely:
   - **Palette:** dominant/accent/background colors as approximate OKLCH or hex,
     with their apparent roles.
   - **Typography:** serif/sans, weight, scale contrast, density.
   - **Spacing & shape:** whitespace generosity, corner radius, borders/shadows.
   - **Motifs:** grids, gradients, texture, iconography style, mood.
3. **Reconcile with Momentum:** map each observed color to the nearest existing
   token; flag where the reference conflicts with the quiet-palette / contrast
   rules and propose an on-brand compromise.
4. Produce the style spec.

## Output format
```
## Style spec from reference
Palette: <color → role → nearest Momentum token>
Typography: <family kind, weights, scale>
Spacing/shape: <radius, density, borders/shadows>
Motifs & mood: <short list>
Conflicts with Momentum: <what, and the on-brand compromise>
Ready-to-use tokens: <inline CSS variables for the artifact>
```

## Quality checks
- Every claim is grounded in the image; uncertainty is stated, not guessed.
- Output is a spec, not a reproduction of copyrighted/trademarked material.

## Safety restrictions
- Do not reproduce logos, brand marks, or copyrighted artwork; extract the
  language (color/type/spacing), not the asset.
- Do not exfiltrate the image or its contents to any external service.

## Examples
- ✅ "Here's a screenshot of a finance app — pull its style into a spec I can use
  for a Momentum-flavored dashboard."
- ❌ "Recreate this company's exact landing page/logo" → decline; extract style
  only.
