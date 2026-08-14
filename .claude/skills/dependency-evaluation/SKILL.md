---
name: dependency-evaluation
description: Use before adding a dependency. Evaluates genuine need, maintenance health, size, license, security, and whether the standard library or existing code suffices.
allowed-tools: [Read, Grep, Glob, Bash]
---

# Dependency Evaluation

Answer before adding anything:
- Do we truly need it, or can existing code/stdlib do it?
- Maintenance: recent releases, open-issue health, single-maintainer risk?
- Size and transitive footprint?
- License compatibility?
- Known advisories (`npm audit`)?

## Output
A recommendation (add / vendor / skip) with the reasoning.
