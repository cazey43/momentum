---
name: performance-investigation
description: Use to investigate a performance problem. Measure before changing anything; fix the proven bottleneck; re-measure to confirm.
allowed-tools: [Read, Grep, Glob, Bash]
---

# Performance Investigation

1. Reproduce and **measure** the slow path (numbers, not vibes).
2. Profile to find the **actual** bottleneck.
3. Apply the smallest change that addresses it.
4. **Re-measure** and report before/after.

## Anti-overengineering
No speculative caching or micro-optimizations without a measurement.
