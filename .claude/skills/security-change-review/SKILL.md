---
name: security-change-review
description: "Use to review a change for security issues: injection, broken authorization, secret exposure, and untrusted-input handling."
allowed-tools: [Read, Grep, Glob]
---

# Security Change Review

Review only the change and its blast radius.

## Checklist
- Input trust boundaries: is external/user/model content treated as untrusted?
- Injection: SQL, command, path, prompt.
- Authorization: is every consequential action re-checked server-side?
- Secrets: none logged, committed, or sent off-machine.

## Output
Findings ranked by severity, each with a concrete failure scenario and fix.
