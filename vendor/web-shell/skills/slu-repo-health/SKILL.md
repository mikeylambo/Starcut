---
name: slu-repo-health
description: Reduce bug surface and future development friction by finding dead assets, duplicate systems, brittle coupling, stale patches, and unused dependencies without speculative rewrites.
license: Apache-2.0
version: 1.0.0
---

# SLU Repo Health

Use for maintenance, cleanup, architecture review, or before major expansion.

## Workflow
1. Identify dead code/assets, duplicate implementations, stale runtime patches, accidental placeholders, oversized modules, unused dependencies, fragile cross-system coupling, and misleading docs/config.
2. Rank findings by player risk and iteration cost.
3. Fix only items that materially reduce bug surface, build friction, test cost, or future implementation time.
4. Preserve working APIs and proven feel unless a migration is justified.
5. Run existing verification/build checks after structural changes.

## Anti-patterns
- speculative rewrites for elegance;
- dependency churn without measurable benefit;
- architecture layers that add indirection but no leverage;
- cleanup that breaks stable semantic interfaces;
- deleting useful debug/playtest tooling merely because it is not shipping UI.

Report what was removed/changed and why it improves future development.
