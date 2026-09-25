---
name: slu-img2threejs
description: Reconstruct an approved reference image as a quality-gated procedural Three.js asset using the official img2threejs workflow, then integrate it safely into SLU web games without moving gameplay authority into presentation geometry.
license: Apache-2.0
version: 1.0.0
---

# SLU img2threejs

Use this skill when the user has approved a reference image and wants it turned into a real-time Three.js game asset, especially for weapons, props, machinery, pickups, portals, architecture modules, stage dressing, or other hard-surface objects.

This is a portable bridge around the official `img2threejs/img2threejs` skill. Do not replace the official quality-gated reconstruction process with a hand-built approximation.

## Required inputs

- An approved reference image.
- Intended game/repository.
- Intended use: hero prop, first-person weapon, environment module, stage prop, etc.
- Integration target/key if one already exists.

If the user says an image is approved or greenlit, treat it as the visual source of truth unless they explicitly revise it.

## Canonical upstream

Official upstream: `https://github.com/img2threejs/img2threejs`

At the start of a reconstruction:
1. Prefer an already-installed local `img2threejs` skill if the host exposes one.
2. Otherwise obtain the official upstream checkout into a temporary/workspace cache using the host's available browser, GitHub, or shell capabilities.
3. Read the upstream `SKILL.md`.
4. Execute the upstream workflow and gates. Do not paraphrase the workflow from memory when the file is available.

If network/bootstrap is unavailable, stop and report that the official reconstruction runtime is unavailable. Never silently substitute a coarse procedural approximation and call it img2threejs output.

## Core workflow

1. Inspect the approved image with agent vision.
2. Run the official img2threejs state gate first.
3. Complete image validation and pre-spec assessment.
4. Build the detail inventory.
5. Author and strict-validate the sculpt spec.
6. Generate pass-by-pass: blockout -> structure -> form -> material -> surface -> lighting -> interaction -> optimization.
7. Capture comparison evidence at every required review gate.
8. Iterate until identity-defining features pass or the upstream correction limit stops the run.
9. Integrate only the final generated factory into the game.
10. Run repository checks/build and report exact status.

## SLU integration contract

For SLU Three.js games:
- Generated art is presentation-only unless the game explicitly declares otherwise.
- Existing collision, targeting, hitboxes, puzzle state, deterministic simulation, and save logic remain authoritative.
- Prefer a stable semantic key such as `weapon.warp-rifle.default`, `actor.diamond.default`, `environment.wall.clean`, or `stage.temple.backdrop`.
- Put generated factories under the game's procedural art/models directory.
- Register the factory through the game's visual manifest/registry.
- Preserve a simple fallback visual where practical.
- Do not add generated child meshes independently to gameplay raycast/collision collections.
- Expose named pivots/sockets for parts that move or emit effects.

Read `references/slu-integration.md` before modifying an SLU game.

## First-person weapon rules

For first-person weapons:
- Optimize for gameplay-camera readability, not concept-sheet orthographic purity.
- Preserve the approved silhouette, proportion relationships, material balance, and identity-defining features.
- Keep the reticle and target area clear.
- Expose at least muzzle socket, recoil pivot, main energy/core pivot when applicable, and effect socket when applicable.
- After integration, require an in-game screenshot review. A model that matches in isolation but reads poorly in first person is not finished.

## Environment rules

For environments:
- Do not reconstruct an entire map as one monolithic model unless explicitly justified.
- Extract reusable modules, materials, and style rules from the approved concept.
- Keep gameplay collision simple and separate from presentation shells.
- Prefer modular walls/floors/columns/arches/platform shells/props/background structures.
- Prefer procedural/material systems before bespoke texture atlases when the visual language allows it.

## Quality bar

Never claim the official img2threejs pipeline ran unless it actually ran.

A successful result must report:
- upstream skill version/commit if available
- reference used
- generated factory path
- visual key
- important pivots/sockets
- review/gate status
- repository build/check status
- any inferred or low-confidence regions

## Output behavior

When the user asks to "wire it in", do the reconstruction and integration rather than giving a paper plan if tools allow it.

When a host lacks the required execution capability, say exactly what is missing and hand off the smallest possible next action.
