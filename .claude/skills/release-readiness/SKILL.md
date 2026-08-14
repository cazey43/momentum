---
name: release-readiness
description: Use before cutting a release. Confirms verification passes, changelog and version are updated, migrations are safe, and a rollback path exists.
allowed-tools: [Read, Grep, Glob, Bash]
---

# Release-Readiness Verification

- Formatter, linter, type check, tests, and production build all green?
- Changelog and version updated?
- Migrations reversible / rollout ordered safely?
- Rollback path documented?

## Output
A go/no-go with any blockers listed.
