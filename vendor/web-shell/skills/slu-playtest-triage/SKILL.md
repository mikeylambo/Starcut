---
name: slu-playtest-triage
description: Convert playtest notes into reproducible bug/readability/balance/emergent-play fixes while preserving good player-discovered tech.
license: Apache-2.0
version: 1.0.0
---

# SLU Playtest Triage

Use whenever the developer reports playtest observations, bugs, skips, confusion, friction, or balance problems.

## Workflow
1. Classify every note: bug, readability, UX, balance, exploit, emergent technique, performance, level-composition, or content issue.
2. Reproduce or trace the causal path before changing code.
3. Identify whether the note breaks the intended mechanic, merely bypasses an authored route, or creates rewarding mastery.
4. Fix root cause with the smallest reliable change.
5. Preserve beneficial emergent movement/routes unless they erase the core challenge.
6. Add regression coverage, telemetry, assertions, debug reproduction hooks, or a written deterministic test path when practical.
7. Re-test adjacent systems likely to share the same cause.

## Report
State the cause, change, validation performed, and anything not yet validated. Never mark a note fixed from code inspection alone when runtime behavior matters.
