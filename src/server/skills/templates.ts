import type { SkillTemplate } from './types'

/**
 * Curated starter skills. Names are chosen NOT to collide with bundled Claude
 * Code skills (e.g. we use `systematic-debugging`, not `debug`). Each core
 * template encodes explicit decision gates, stopping conditions, expected
 * outputs, and anti-overengineering rules.
 */

const systematicDebugging: SkillTemplate = {
  slug: 'systematic-debugging',
  title: 'Systematic Debugging',
  category: 'core',
  summary: 'Forces reproduce → isolate → hypothesis → root cause → smallest fix → regression test.',
  useCases: ['A bug or failing test', 'Intermittent/flaky failures', 'Regressions after a change'],
  frontmatter: {
    name: 'systematic-debugging',
    description:
      'Use when investigating a bug, failing test, crash, or regression. Enforces a disciplined reproduce-isolate-fix loop and prevents speculative rewrites.',
    'allowed-tools': ['Read', 'Grep', 'Glob', 'Bash'],
  },
  body: `# Systematic Debugging

Follow this sequence. Do not skip ahead to a fix.

1. **Reproduce** the problem with a concrete command or steps.
2. **Capture** the exact error text and the environment (versions, OS, inputs).
3. **Inspect** the relevant code paths and recent changes (\`git log\`, \`git diff\`).
4. **Separate facts from assumptions** — write down which is which.
5. **Form ONE falsifiable hypothesis** about the root cause.
6. **Run the smallest isolated test** capable of disproving it.
7. **Identify the root cause** before touching production logic.
8. **Apply the smallest safe fix** — no unrelated cleanup, no refactors.
9. **Add a regression test** that fails without the fix and passes with it.
10. **Run relevant verification** and report the evidence (commands + output).

## Decision gates
- Cannot reproduce? Stop and gather more information; do not guess-fix.
- Hypothesis survived the test? It is wrong or incomplete — form a new one.
- Fix touches more than the root cause? Split it; justify each extra line.

## Stopping conditions
- Root cause identified, smallest fix applied, regression test green, suite green.

## Anti-overengineering rules
- No speculative multi-file rewrites.
- No fixes that only hide a symptom (swallowed errors, broadened catches).
- No opportunistic refactors in the same change.

## Expected output
Root cause, the one-line-ish fix, the regression test, and verification evidence.`,
}

const socraticDesign: SkillTemplate = {
  slug: 'socratic-design',
  title: 'Socratic Design',
  category: 'core',
  summary: 'Structured discovery and an ADR before high-impact implementation.',
  useCases: [
    'New feature or subsystem',
    'Irreversible/high-impact design',
    'Ambiguous requirements',
  ],
  frontmatter: {
    name: 'socratic-design',
    description:
      'Use before implementing a significant or hard-to-reverse feature. Drives structured discovery, offers 2-3 approaches with tradeoffs, and records an ADR. Do not use for minor reversible work.',
    'allowed-tools': ['Read', 'Grep', 'Glob'],
  },
  body: `# Socratic Design

Discover before you build — but only when the work warrants it.

## Discovery (ask ONE high-impact question at a time)
Clarify: the user, desired outcome, constraints, existing architecture, data
flow, edge cases, security, accessibility, and success criteria. Ask a question
only when the answer materially changes the design.

## Decision gates
- Is this reversible and small? → Skip discovery; just build it.
- Does a wrong choice here cost a rewrite? → Full discovery + approval.

## Produce
1. Required behavior vs optional enhancements (explicitly separated).
2. Two or three viable approaches, each with concrete tradeoffs.
3. A recommendation and why.
4. A short **Architecture Decision Record**: context, options, decision,
   consequences.

## Stopping conditions
- For high-impact/irreversible designs: obtain explicit approval before coding.
- For everything else: record the ADR and proceed.

## Anti-overengineering rules
- Do not turn minor, reversible work into an interview.
- Do not present more than three approaches; pick the strongest.

## Expected output
An ADR plus a clear go/no-go recommendation.`,
}

const tddEnforcer: SkillTemplate = {
  slug: 'tdd-enforcer',
  title: 'TDD Enforcer',
  category: 'core',
  summary: 'Red-green-refactor with focused-then-broad verification.',
  useCases: [
    'New logic with observable behavior',
    'Bug fixes needing a regression test',
    'Refactors under test',
  ],
  frontmatter: {
    name: 'tdd-enforcer',
    description:
      'Use when implementing new behavior or fixing a bug that should be covered by tests. Enforces red-green-refactor. Allows documented exceptions for generated files, pure styling, and emergency diagnostics.',
    'allowed-tools': ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'],
  },
  body: `# TDD Enforcer

Red → Green → Refactor.

1. Translate the requirement into **observable behavior**.
2. Write the **smallest meaningful failing test**.
3. Confirm it **fails for the expected reason** (run it).
4. Implement **only enough** logic to pass.
5. **Refactor** while keeping tests green.
6. Run **focused tests**, then the **broader relevant suite**.
7. Report **what was tested** and any **coverage gaps**.

## Decision gates
- Test passes before you wrote the code? It is not testing the new behavior.
- Test mirrors the implementation line-for-line? Rewrite it around behavior.

## Documented exceptions (a test is not always meaningful)
- Generated files, pure styling/markup changes, throwaway diagnostics.
  State the exception explicitly when you take it.

## Stopping conditions
- Behavior covered by a meaningful test, focused + relevant suites green.

## Anti-overengineering rules
- No tests that assert on private internals for their own sake.
- No gold-plating beyond the requirement's observable behavior.

## Expected output
The failing-then-passing test, the implementation, and the suite result.`,
}

const commitGuardian: SkillTemplate = {
  slug: 'commit-guardian',
  title: 'Commit Guardian',
  category: 'core',
  summary:
    'Manual-only pre-commit review: split unrelated changes, flag secrets, verify, Conventional Commit.',
  useCases: ['Before committing', 'Reviewing a messy working tree', 'Generating a commit message'],
  frontmatter: {
    name: 'commit-guardian',
    description:
      'Manually invoked pre-commit reviewer. Inspects the diff, flags secrets/artifacts/unrelated changes, runs verification, and drafts a Conventional Commit message.',
    'disable-model-invocation': true,
    'user-invocable': true,
    'allowed-tools': ['Read', 'Grep', 'Glob', 'Bash'],
  },
  body: `# Commit Guardian

Manually invoked only (\`disable-model-invocation: true\`). Never commits, amends,
pushes, force-pushes, rebases, or bypasses hooks without explicit authorization.

## Steps
1. Inspect \`git status\` and the **complete** diff (staged and unstaged).
2. Detect **unrelated changes** and recommend splitting them into separate commits.
3. Flag **secrets, generated artifacts, debugging code, and large files**.
4. Run the project's **relevant verification** (formatter, linter, types, tests)
   before recommending a commit.
5. Draft a **Conventional Commit** message in the project's existing style.

## Decision gates
- More than one logical change? Recommend splitting; never bundle them.
- Any secret/large/generated file staged? Stop and surface it.
- Verification failed? Do not recommend committing.

## Hard prohibitions
- Never stage unrelated changes.
- Never amend, push, force-push, rebase, or skip hooks without explicit approval.

## Expected output
A concise summary: what will be committed, what was excluded and why, the
verification result, and the proposed commit message(s).`,
}

const frontendDesign: SkillTemplate = {
  slug: 'frontend-design',
  title: 'Frontend Design',
  category: 'core',
  summary:
    'Prevents generic UI: concept, design-system reuse, full states, a11y, responsive, visual verification.',
  useCases: ['Building or restyling UI', 'New components/screens', 'Design polish passes'],
  frontmatter: {
    name: 'frontend-design',
    description:
      'Use when building or restyling user interface. Requires a clear visual concept, reuse of the existing design system, complete states, WCAG AA accessibility, responsive behavior, and visual browser verification.',
    'allowed-tools': ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
  },
  body: `# Frontend Design

Ship interfaces that look intentional, not generated.

## Requirements
- A clear **visual concept** appropriate to the product and audience.
- **Reuse the existing design system** (tokens, components) before adding primitives.
- Intentional **typography, spacing, hierarchy, color, and interaction states**.
- **Responsive** at mobile (~390px), tablet (~768px), and desktop (~1440px).
- **Accessibility**: WCAG AA contrast, keyboard access, visible focus, semantic
  HTML, and \`prefers-reduced-motion\` support.
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
The implemented UI, the states covered, and a note on the visual verification.`,
}

const optional: SkillTemplate[] = [
  {
    slug: 'security-change-review',
    title: 'Security Change Review',
    category: 'optional',
    summary:
      'Reviews a diff for injection, authz gaps, secret handling, and unsafe trust boundaries.',
    useCases: ['Auth/payment/PII changes', 'New external inputs', 'Pre-merge security pass'],
    frontmatter: {
      name: 'security-change-review',
      description:
        'Use to review a change for security issues: injection, broken authorization, secret exposure, and untrusted-input handling.',
      'allowed-tools': ['Read', 'Grep', 'Glob'],
    },
    body: `# Security Change Review

Review only the change and its blast radius.

## Checklist
- Input trust boundaries: is external/user/model content treated as untrusted?
- Injection: SQL, command, path, prompt.
- Authorization: is every consequential action re-checked server-side?
- Secrets: none logged, committed, or sent off-machine.

## Output
Findings ranked by severity, each with a concrete failure scenario and fix.`,
  },
  {
    slug: 'performance-investigation',
    title: 'Performance Investigation',
    category: 'optional',
    summary: 'Measure-first performance work: profile, find the hot path, fix, re-measure.',
    useCases: ['Slow endpoint or query', 'High memory/CPU', 'Regression in latency'],
    frontmatter: {
      name: 'performance-investigation',
      description:
        'Use to investigate a performance problem. Measure before changing anything; fix the proven bottleneck; re-measure to confirm.',
      'allowed-tools': ['Read', 'Grep', 'Glob', 'Bash'],
    },
    body: `# Performance Investigation

1. Reproduce and **measure** the slow path (numbers, not vibes).
2. Profile to find the **actual** bottleneck.
3. Apply the smallest change that addresses it.
4. **Re-measure** and report before/after.

## Anti-overengineering
No speculative caching or micro-optimizations without a measurement.`,
  },
  {
    slug: 'dependency-evaluation',
    title: 'Dependency Evaluation',
    category: 'optional',
    summary: 'Weighs a new dependency: need, maintenance, size, license, security, alternatives.',
    useCases: ['Considering a new package', 'Replacing hand-rolled code', 'Audit before adding'],
    frontmatter: {
      name: 'dependency-evaluation',
      description:
        'Use before adding a dependency. Evaluates genuine need, maintenance health, size, license, security, and whether the standard library or existing code suffices.',
      'allowed-tools': ['Read', 'Grep', 'Glob', 'Bash'],
    },
    body: `# Dependency Evaluation

Answer before adding anything:
- Do we truly need it, or can existing code/stdlib do it?
- Maintenance: recent releases, open-issue health, single-maintainer risk?
- Size and transitive footprint?
- License compatibility?
- Known advisories (\`npm audit\`)?

## Output
A recommendation (add / vendor / skip) with the reasoning.`,
  },
  {
    slug: 'documentation-sync',
    title: 'Documentation Synchronization',
    category: 'optional',
    summary: 'Finds docs that drifted from the code a change touched, and updates them.',
    useCases: ['After an API change', 'Renamed/moved modules', 'README/setup drift'],
    frontmatter: {
      name: 'documentation-sync',
      description:
        'Use after a change to find and update documentation that has drifted from the code — READMEs, setup steps, API docs, and comments.',
      'allowed-tools': ['Read', 'Grep', 'Glob', 'Edit'],
    },
    body: `# Documentation Synchronization

1. Identify what the change altered (public API, config, commands, structure).
2. Grep docs for references to the old shape.
3. Update them to match; do not invent behavior that does not exist.

## Output
The list of docs updated and what changed in each.`,
  },
  {
    slug: 'release-readiness',
    title: 'Release-Readiness Verification',
    category: 'optional',
    summary: 'Gate before release: verification green, changelog, version, migrations, rollback.',
    useCases: ['Cutting a release', 'Pre-deploy checklist', 'Tag/version bump'],
    frontmatter: {
      name: 'release-readiness',
      description:
        'Use before cutting a release. Confirms verification passes, changelog and version are updated, migrations are safe, and a rollback path exists.',
      'allowed-tools': ['Read', 'Grep', 'Glob', 'Bash'],
    },
    body: `# Release-Readiness Verification

- Formatter, linter, type check, tests, and production build all green?
- Changelog and version updated?
- Migrations reversible / rollout ordered safely?
- Rollback path documented?

## Output
A go/no-go with any blockers listed.`,
  },
  {
    slug: 'db-migration-safety',
    title: 'Database Migration Safety',
    category: 'optional',
    summary: 'Reviews a migration for lock risk, backfill safety, and reversibility.',
    useCases: ['Schema changes', 'Backfills on large tables', 'Zero-downtime deploys'],
    frontmatter: {
      name: 'db-migration-safety',
      description:
        'Use to review a database migration for locking, data loss, backfill safety, and reversibility before it runs against real data.',
      'allowed-tools': ['Read', 'Grep', 'Glob'],
    },
    body: `# Database Migration Safety

- Will it lock a large table? Prefer online/'concurrent' operations.
- Is it reversible, or is there a forward-fix plan?
- Backfill batched and idempotent?
- Old and new code both tolerate the intermediate schema?

## Output
Risks found and the safe rollout order.`,
  },
]

export const SKILL_TEMPLATES: readonly SkillTemplate[] = [
  systematicDebugging,
  socraticDesign,
  tddEnforcer,
  commitGuardian,
  frontendDesign,
  ...optional,
]

export function getTemplate(slug: string): SkillTemplate | undefined {
  return SKILL_TEMPLATES.find((t) => t.slug === slug)
}
