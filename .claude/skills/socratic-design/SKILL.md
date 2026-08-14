---
name: socratic-design
description: Use before implementing a significant or hard-to-reverse feature. Drives structured discovery, offers 2-3 approaches with tradeoffs, and records an ADR. Do not use for minor reversible work.
allowed-tools: [Read, Grep, Glob]
---

# Socratic Design

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
An ADR plus a clear go/no-go recommendation.
