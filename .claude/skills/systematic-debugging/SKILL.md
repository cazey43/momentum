---
name: systematic-debugging
description: Use when investigating a bug, failing test, crash, or regression. Enforces a disciplined reproduce-isolate-fix loop and prevents speculative rewrites.
allowed-tools: [Read, Grep, Glob, Bash]
---

# Systematic Debugging

Follow this sequence. Do not skip ahead to a fix.

1. **Reproduce** the problem with a concrete command or steps.
2. **Capture** the exact error text and the environment (versions, OS, inputs).
3. **Inspect** the relevant code paths and recent changes (`git log`, `git diff`).
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
Root cause, the one-line-ish fix, the regression test, and verification evidence.
