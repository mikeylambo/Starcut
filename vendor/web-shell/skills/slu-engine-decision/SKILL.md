---
name: slu-engine-decision
description: Keep web/Three.js games in place unless a concrete blocker justifies migration, and port semantic systems/data rather than translating implementation line by line when migration is necessary.
license: Apache-2.0
version: 1.0.0
---

# SLU Engine Decision

Use when deciding whether to stay in Three.js/web, move to Godot/Unity/another engine, or plan a port.

## Decision test
Do not recommend migration from vague assumptions that an engine is "more professional." Identify a concrete blocker in rendering, performance, tooling, content authoring, platform access, networking, input/device support, asset pipeline, distribution, or maintainability.

## Workflow
1. List what the current stack already solves and what is genuinely blocked.
2. Estimate whether the blocker can be removed cheaper than migration.
3. Consider timing: a migration may make sense later even if it does not make sense now.
4. If staying, invest in reusable tooling and semantic boundaries that keep a future port possible.
5. If migrating, port data models, semantic actions/events, gameplay rules, content definitions, save schemas, and proven feel targets first.
6. Rebuild renderer/physics/input integrations natively in the destination engine rather than translating code line-by-line.
7. Validate feel and player loop parity before adding new scope on the destination branch.

## Rule
Engine choice is an implementation decision. The game design should not be artificially reduced merely to avoid a migration discussion.
