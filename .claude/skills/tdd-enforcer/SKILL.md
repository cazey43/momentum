---
name: tdd-enforcer
description: Use when implementing new behavior or fixing a bug that should be covered by tests. Enforces red-green-refactor. Allows documented exceptions for generated files, pure styling, and emergency diagnostics.
allowed-tools: [Read, Grep, Glob, Bash, Edit, Write]
---

# TDD Enforcer

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
The failing-then-passing test, the implementation, and the suite result.
