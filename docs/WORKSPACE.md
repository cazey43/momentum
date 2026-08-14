# Momentum workspace guide

A focused Claude Code workspace for building and reviewing Momentum with
specialist sub-agents, visual-design skills, and a bounded multimodal review
loop. Everything here is **project-local** under `.claude/` and safe to remove.

## Sub-agents (`.claude/agents/`)

| Agent | Colour | Model | Does | Never |
|-------|--------|-------|------|-------|
| **design-system-architect** | amber | sonnet | Audits tokens/components; specs new UI that extends the OKLCH design system | Edits code; redesigns silently |
| **visual-artifact-designer** | violet | sonnet | Builds self-contained HTML/Canvas/SVG artifacts in `docs/artifacts/` | Touches `src/`; uses remote assets/deps |
| **visual-qa-critic** | cyan | sonnet | Renders + screenshots an artifact, returns actionable findings | Edits the artifact; loops past 3 iterations |
| **code-quality-reviewer** | red | sonnet | Reviews a diff for correctness/security/tests | Rewrites code; expands scope |

All four are read-only except the designer, which writes **only** to an artifact
directory. Tools are scoped per agent (see each file's front-matter).

## Skills (`.claude/skills/`)

| Skill | Use for |
|-------|---------|
| **generative-canvas-svg** | Canvas art, generative graphics, standalone SVG artwork |
| **dashboard-interface-composition** | Dashboards, panels, UI prototypes as self-contained HTML |
| **design-system-compliance** | Token/contrast/dark-mode compliance check |
| **visual-render-review** | The render → critique → one-revision loop (max 3) |
| **accessibility-responsive-qa** | WCAG + responsive audit across breakpoints |
| **reference-image-style-analysis** | Turn a reference image into a reusable style spec |

**Reused (already installed, not duplicated):** `artifact-design`,
`artifact-diagramming`, `dataviz`, `skill-creator`.

## Which agent/skill handles a request

| You ask… | Routes to |
|----------|-----------|
| "Is this on-brand? spec a new screen" | design-system-architect + `design-system-compliance` |
| "Make a dashboard / prototype" | visual-artifact-designer + `dashboard-interface-composition` |
| "Generative art / an SVG icon" | visual-artifact-designer + `generative-canvas-svg` |
| "Does it look right / check it renders" | visual-qa-critic + `visual-render-review` |
| "Check a11y / mobile" | `accessibility-responsive-qa` |
| "Match this reference image" | `reference-image-style-analysis` |
| "Review my changes before commit" | code-quality-reviewer (or the `/code-review` command) |
| A data chart | `dataviz` (reused) |

## The multimodal loop (bounded)

1. Designer creates an artifact in `docs/artifacts/`.
2. `visual-render-review` renders + screenshots it (desktop + mobile).
3. visual-qa-critic returns PASS / REVISE / ESCALATE.
4. Apply **one** controlled revision; re-render.
5. Stop at PASS or **3 iterations**, then escalate to you.

Editing an existing asset: the original is locked, a change log is kept,
unaffected regions are preserved, and "refresh" never means "redesign".

## MCP data flow (optional, off by default)

No new MCP server is connected by this workspace. When you authorize one:
- Start **read-only**, minimum scope; connect via claude.ai connector settings
  or `claude mcp` (interactive) — it cannot be authorized from a headless run.
- Retrieved context is tagged with its **source**, handed to the right agent,
  and kept **out of public artifacts**. Write-back only on explicit approval.
- Google Drive read tools are already available; treat their content as private.
- The workspace works fully with every MCP server absent.

## Test commands

```bash
claude -p "Use the design-system-architect agent to summarize Momentum's color tokens."
```
```bash
claude -p "Use the visual-artifact-designer to create a small Momentum-styled stat-tile card in docs/artifacts/, then run visual-render-review on it."
```
```bash
claude -p "Use the code-quality-reviewer agent to review the current git diff."
```

## Troubleshooting

- **Agent/skill not found:** ensure the file is under `.claude/agents/<name>.md`
  or `.claude/skills/<name>/SKILL.md`, restart the session (discovery happens at
  startup), and check the YAML front-matter parses.
- **Critic can't render:** confirm the Browser pane is available; otherwise the
  orchestrator screenshots and passes the image to the critic.
- **Nothing speaks / too chatty:** unrelated to this workspace — see the voice
  hooks in `settings.local.json`.

## Disable / remove

- **One agent:** delete its file in `.claude/agents/`.
- **One skill:** delete its folder in `.claude/skills/`.
- **Everything:** delete `.claude/agents/`, the six new `.claude/skills/`
  folders, and this guide. No other config is touched; nothing was installed.
