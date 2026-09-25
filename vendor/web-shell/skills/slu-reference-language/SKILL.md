---
name: slu-reference-language
description: Turn approved visual references into transferable game art-direction rules instead of copying one object or screenshot literally across the project.
license: Apache-2.0
version: 1.0.0
---

# SLU Reference to Game Language

Use when the developer provides visual reference images, screenshots, concept art, UI references, or a target aesthetic.

## Workflow
1. Inspect the reference at both whole-image and detail level.
2. Extract silhouette, proportion, material families, palette, lighting, negative space, typography, graphic motifs, surface hierarchy, VFX, camera, and composition.
3. Separate object-specific details from transferable design rules.
4. Identify which existing game elements should inherit each rule and which should remain distinct for readability.
5. Preserve the game's established mechanics, silhouette grammar, and identity.
6. Build representative in-game examples at actual gameplay scale.
7. Review screenshots in context, not only isolated asset renders.

## Rules
- Propagate systems, not one hero asset.
- Do not let a single reference redefine the whole fiction unless explicitly approved.
- Never sacrifice gameplay readability for material fidelity.
- Prefer consistent material/lighting/shape grammar across the weakest visible layers.
- Use `slu-img2threejs` for approved hard-surface assets when appropriate.

## Output
A concrete implementation pass: updated assets/materials/UI/environment/VFX plus a short note on the extracted design language and any intentionally preserved exceptions.
