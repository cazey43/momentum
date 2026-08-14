---
name: db-migration-safety
description: Use to review a database migration for locking, data loss, backfill safety, and reversibility before it runs against real data.
allowed-tools: [Read, Grep, Glob]
---

# Database Migration Safety

- Will it lock a large table? Prefer online/'concurrent' operations.
- Is it reversible, or is there a forward-fix plan?
- Backfill batched and idempotent?
- Old and new code both tolerate the intermediate schema?

## Output
Risks found and the safe rollout order.
