---
name: documentation-sync
description: Use after a change to find and update documentation that has drifted from the code — READMEs, setup steps, API docs, and comments.
allowed-tools: [Read, Grep, Glob, Edit]
---

# Documentation Synchronization

1. Identify what the change altered (public API, config, commands, structure).
2. Grep docs for references to the old shape.
3. Update them to match; do not invent behavior that does not exist.

## Output
The list of docs updated and what changed in each.
