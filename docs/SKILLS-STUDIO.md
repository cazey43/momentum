# Skills Studio

A local-first workspace for creating, inspecting, and organizing Claude Code
skills, built as a native route in the Momentum app.

Open it at **`/studio`** (linked under **Developer** in the sidebar).

## What it does

- **Dashboard** — every skill found across scopes, grouped and searchable, with
  status (Valid / Warning / Conflict / Invalid), invocation command, last
  modified, and an estimated prompt footprint. Filter by scope/status, sort,
  favorite, and switch grid/compact.
- **Templates** — the five core starter skills plus six optional ones, each with
  purpose, use cases, a workflow preview, permissions, and one-click **Install**
  or **Customize**.
- **Create** — Guided and Expert modes with a live `SKILL.md` preview, YAML
  validation, permission/quality warnings, destination path, and conflict
  detection. Overwrites require explicit confirmation.
- **Conflicts** — visualizes duplicate names across scopes, which definition is
  active and why. It reports only; it never resolves automatically.
- **Install** — every install pathway with a trust label and the *exact*
  copyable command. The studio never executes a third-party installer for you.
- **Commands** — copyable commands for invoking skills and opening `/plugin`,
  plus a ⌘K command palette.
- **Inspector** (right panel) — details, validation, and Edit / Duplicate /
  Export / recoverable Delete for the selected skill.

## Scopes and precedence

Skills are discovered from:

| Scope | Location | Writable |
|-------|----------|----------|
| Project | `.claude/skills/<name>/SKILL.md` | yes (default for new skills) |
| Personal | `~/.claude/skills/<name>/SKILL.md` | yes (explicit choice) |
| Plugin | `~/.claude/plugins/**/skills/<name>/SKILL.md` | read-only |

When one slug exists in several scopes, the winner is the most specific:
**`project > personal > plugin > bundled`**. This is the studio's documented
model, surfaced in the Conflicts tab — it never edits to resolve a clash.

## Curated starter skills

Core (installable from Templates): `systematic-debugging`, `socratic-design`,
`tdd-enforcer`, `commit-guardian` (manual-only), `frontend-design`. Optional:
`security-change-review`, `performance-investigation`, `dependency-evaluation`,
`documentation-sync`, `release-readiness`, `db-migration-safety`.

Install one, then invoke it by its command, e.g. `/systematic-debugging`.
After installing, run `/help` to confirm the exact registered command rather than
assuming the name. New skills are discovered when Claude Code (re)starts.

## Safety

- **Path safety** — every write is resolved through a single choke point that
  rejects `..`, separators, and absolute paths; a skill can never be written
  outside its scope root.
- **Atomic writes** — SKILL.md is written to a temp file and renamed, so a crash
  never leaves a half-written file.
- **Recoverable delete** — deleting moves the skill to `<root>/.trash/…` rather
  than removing it.
- **Read-only scopes** — plugin/bundled skills are inspect-only.
- **Overwrite confirmation** — creating over an existing skill requires a
  second, explicit confirmation.
- **No remote execution** — the Install center only ever copies commands; it
  shows a trust label and warning and asks you to review source first.
- **Unknown frontmatter preserved** — editing a skill keeps fields the studio
  does not model, verbatim.

## Architecture

- `src/server/skills/` — pure, tested service layer: `frontmatter` (parse /
  serialize, preserves unknown keys), `slug`, `paths` (scope roots + safety),
  `validate`, `precedence`, `scan` (filesystem read), `write` (atomic write,
  trash, settings merge), `templates`.
- `src/app/studio/` — `page.tsx` (server component that scans and passes data),
  `actions.ts` (`'use server'` — the only path to the filesystem), and
  `StudioApp.tsx` (the three-region client UI).

The Next.js server runtime is the trusted local backend; the browser never
touches the filesystem directly.

## Tests

`src/server/skills/parse.test.ts` and `fs.test.ts` cover frontmatter parsing and
round-tripping, slug normalization, path-traversal rejection, precedence /
shadowing, validation rules, atomic writes, overwrite protection, recoverable
delete, and settings preservation. Run them with `npm run test`.

## Limitations

- Newly created skills require a Claude Code restart to be discovered by the CLI.
- Precedence across scopes is the studio's documented model; confirm against your
  Claude Code version if behavior differs.
- Importing a local directory and third-party installs are surfaced as exact
  commands to run yourself — the studio never runs them.
