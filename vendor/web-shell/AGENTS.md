# SLU Web Game Shell — Agent Instructions

The shell is the canonical carrier for the shared SLU game-development constitution. Consumer games may add stricter project-specific rules, but should not weaken these defaults without an explicit project decision.

## SLU Game Development Constitution

### 1. Build the largest playable, closest-to-release version
Do not default to tiny MVPs, paper-only prototypes, or artificial vertical slices when the existing Shell, reusable systems, proven genre patterns, or prior game modules make a larger playable practical. Prefer the build that feels most like a released game as early as possible.

### 2. Solo developer is an implementation constraint, not a creative scope constraint
Do not recommend cuts simply because the developer is solo. First search for cheaper architectures, reusable systems, procedural content, AI-assisted authoring, commercially proven structures, templates, and cross-project leverage. Cut only when a feature is genuinely low-value, technically blocking, or explicitly deprioritized.

### 3. Gameplay and visuals may advance together
Do not force an artificial sequence where gameplay must be fully complete before visual work begins, or vice versa. Improve the weakest player-facing layers in parallel when doing so accelerates iteration or makes playtesting more representative.

### 4. Implementation over speculation
When a change is cheap, reversible, and testable, implement it rather than spending excessive time discussing it on paper. Use playtest evidence to drive revisions. Reserve heavy up-front design for expensive or hard-to-reverse decisions.

### 5. Preserve proven feel
Do not casually rewrite movement, camera, combat, input response, hit timing, or other systems that already feel good while working on unrelated tasks. Treat proven feel as protected behavior unless the task explicitly targets it.

### 6. Separate gameplay authority from presentation
Collision, targeting, deterministic state, puzzle logic, movement geometry, and simulation remain authoritative and simple where practical. Rich presentation geometry, materials, VFX, UI, and audio should be mounted or mapped separately so visual upgrades do not destabilize gameplay.

### 7. Stable semantic interfaces
Prefer semantic IDs and registries for inputs, audio, art, actors, upgrades, modes, objectives, and other cross-cutting systems. Gameplay should say what happened, not which file, sprite, sound, mesh, button, or device represents it.

### 8. No unnecessary player-facing copy
Do not add player-facing text unless it helps the player understand what happened, what they can do, or make a choice. Do not invent system names, acronyms, lore labels, decorative subtitles, taglines, explanatory microcopy, or internal design terminology merely to fill space. Empty space is valid. Prefer iconography, layout, animation, shape, color, sound, and state when they communicate sufficiently.

### 9. Shape and behavior before color
Important gameplay categories must remain distinguishable through silhouette, motion, pattern, timing, sound, or behavior rather than color alone. Accessibility is part of the base design, not a cleanup pass.

### 10. One semantic input layer
Keyboard/mouse, gamepad, and touch map into the same gameplay actions. Gameplay systems should not care which device fired the action. If a game supports gamepad or touch, the full boot → menu → gameplay → pause → results → retry/return loop must be usable with that device.

### 11. Mobile is a first-class control scheme
Do not treat mobile as a desktop UI squeezed onto a smaller screen. Preserve the game, redesign the interaction: thumb reach, safe areas, target size, orientation, gesture fit, performance, readable HUD density, and no hover dependence.

### 12. Prefer composition before mechanic proliferation
When expanding content, first combine existing verbs, enemies, hazards, actors, movement rules, and scoring in deeper ways. Add a new mechanic when it creates meaningful new play, not merely to make a new level look different.

### 13. Proven commercial structure is leverage
When a genre already has commercially proven loops, menus, upgrade flows, pacing, scoring, progression, or content cadence, reproduce the useful foundation quickly before inventing alternatives. Differentiate where the game has a real thesis, not by discarding solved structure.

### 14. Performance is judged at the gameplay worst case
Profile the heaviest representative scene, enemy count, VFX stack, actor count, and device class. Do not claim performance from title screens or empty rooms. Prefer premium-looking assets inside efficient scene composition.

### 15. Do not recommend engine migration without a concrete blocker
For web/Three.js games, remain web-first unless rendering, tooling, performance, platform access, content scale, or another specific requirement creates a real blocker. If migration happens, port semantic systems/data and proven feel rather than translating implementation line-by-line.

### 16. Game feel is layered, not entangled
Input response, camera, animation timing, hitstop, recoil, screen shake, particles, trails, bloom, and audio may be tuned together, but presentation effects should not become the authoritative mechanic logic.

### 17. Audio is semantic
Gameplay emits semantic events such as `weapon.fire`, `warp.commit`, `enemy.hit`, `ui.confirm`. Asset selection, layering, variation, spatialization, buses, and fallback behavior live in the audio layer. Evaluate complementary takes for layering before discarding them.

### 18. Emergent play is not automatically a bug
For skips, alternate routes, unusual movement, and puzzle bypasses, determine whether the result invalidates the intended mechanic or creates rewarding mastery. Fix exploits that erase the game; preserve tech that deepens it.

### 19. Difficulty should scale information and execution before raw stats
Prefer telegraph clarity, timing, forgiveness windows, route demands, enemy behavior, resource pressure, and assist information before HP/damage inflation. Difficulty should change mastery demands, not merely lengthen encounters.

### 20. Protect saves and player state
Do not silently break persistence. Schema changes need migration, defaults, or compatible fallback behavior.

### 21. No busywork architecture
Do not create abstractions, documents, branches, dependency layers, tools, or refactors merely because they look organized. Every structural addition should directly improve iteration speed, correctness, reuse, debugging, content throughput, or player quality.

### 22. Dependencies must earn their cost
Prefer the existing stack and native platform capabilities unless a new dependency materially improves speed, quality, maintainability, or capability.

### 23. One intent per commit and truthful reports
Commits should describe actual work. Reports must state what changed, what was tested, what was not tested, the real branch/commit, and actual deploy status. Never invent test coverage, hashes, branch names, successful builds, or runtime validation.

### 24. Do not waste deploys
Use local/CI validation where possible. Deploy when remote-device, browser, stakeholder, or public playtest validation is actually useful.

### 25. Reversible decisions fast; irreversible decisions carefully
Move quickly on CSS, presentation, tuning, layout, content values, and other reversible choices. Slow down for save formats, engine migrations, core mechanic replacement, networking architecture, monetization structure, and other expensive commitments.

## Reusable development skills / playbooks

Agents should select and apply these playbooks automatically when the task matches. They are workflow contracts, not reasons to create extra documents.

### Skill: `largest-playable-pass`
Use when starting or substantially expanding a game.
- Inventory reusable Shell systems, prior genre systems, available assets, and commercially proven structure.
- Build toward the broadest coherent playable loop that can reasonably be implemented now.
- Include real menu flow, game loop, results/retry, settings/input parity, and enough content/progression to feel product-like.
- Avoid placeholder-only "proof" builds when production-grade versions are already practical.
- Do not reduce scope merely to satisfy MVP convention.

### Skill: `reference-to-game-language`
Use when given a visual reference.
- Extract silhouette, proportion, materials, lighting, palette, surface hierarchy, typography, graphic motifs, VFX, and negative-space rules.
- Separate transferable art-direction rules from literal object-specific details.
- Apply the language selectively across the game's vocabulary rather than cloning one asset everywhere.
- Preserve gameplay readability and the game's existing identity.

### Skill: `game-visual-pass`
Use for broad visual upgrades.
- Audit the whole player-visible stack at normal gameplay scale: environment, actors, player/weapon, VFX, lighting, HUD, menus, transitions, mobile UI.
- Rank the weakest visible layers and improve them in coherent groups.
- Gameplay behavior should remain unchanged unless the task explicitly includes gameplay changes.
- Prefer visual-system consistency over one hero-quality asset surrounded by placeholders.

### Skill: `playtest-triage`
Use on playtest notes and bug lists.
- Classify each note as bug, readability problem, balance issue, exploit, emergent technique, UX issue, performance issue, or content-composition issue.
- Reproduce or trace the cause before changing code.
- Fix root causes rather than symptoms.
- Preserve beneficial emergent play.
- Add a regression check, assertion, telemetry hook, or reproducible validation where practical.

### Skill: `game-feel-pass`
Use for movement/combat/camera polish.
- Measure/tune input latency, acceleration/deceleration, turn response, camera, animation timing, anticipation, impact, hitstop, recoil, shake, particles, trails, sound, and recovery.
- Protect the underlying mechanic unless evidence shows the mechanic itself is faulty.
- Tune at real gameplay speed and camera distance, not isolated debug views.

### Skill: `mobile-port-pass`
Use whenever a web game gains or already has touch support.
- Map touch into the semantic input layer.
- Validate thumb zones, safe areas, landscape/portrait strategy, UI density, tap target size, gesture conflicts, browser audio unlock, pointer/touch behavior, and mobile performance.
- Preserve the full game rather than creating a reduced "mobile-lite" feature set unless explicitly requested.
- Test the complete player loop with touch only.

### Skill: `controller-parity-pass`
Use when controller support exists or is requested.
- Ensure every menu, modal, settings screen, game state, results screen, retry, and return path works without mouse/keyboard.
- Maintain obvious focus state and sensible default focus.
- Prevent input mode conflicts and duplicate activation.

### Skill: `content-expansion-pass`
Use when building levels, rooms, stages, enemy waves, challenges, or acts.
- Inventory existing verbs and proven combinations first.
- Build substantial playable content directly when authoring cost is low.
- Compose old mechanics in new timing/spatial/context combinations before adding new systems.
- Track intended solutions and meaningful alternate solutions where relevant.

### Skill: `commercial-foundation-pass`
Use when a game is based on or adjacent to a commercially proven game/genre.
- Identify the proven baseline loop, pacing, menus, upgrade economy, progression, retry cadence, content structure, onboarding, and feedback.
- Reproduce the useful foundation faithfully enough to inherit its solved UX/game-loop lessons.
- Differentiate through the project's actual hook rather than by omitting expected genre fundamentals.

### Skill: `semantic-audio-pass`
Use for SFX/music implementation.
- Keep semantic event emission separate from authored assets.
- Evaluate takes for transient/body/air/tail roles and layer complementary sources when useful.
- Route through buses, provide fallbacks, spatialize world cues appropriately, and keep accessibility/non-audio cues intact.

### Skill: `accessibility-readability-pass`
Use during normal development, not only at release.
- Audit color dependence, flash, motion, contrast, text scaling, input alternatives, telegraph uniqueness, and important audio-only information.
- Fix gameplay categories with non-color identifiers first.
- Accessibility options must preserve game logic and competitive fairness where relevant.

### Skill: `performance-budget-pass`
Use before declaring a build performant.
- Define representative worst-case scenes and target devices.
- Measure frame time, draw calls, memory, texture pressure, actor counts, and expensive effects where tooling allows.
- Optimize scene composition and invisible complexity before sacrificing the core visual identity.
- Maintain scalable presentation tiers without changing authoritative gameplay.

### Skill: `repo-health-pass`
Use for maintenance requests.
- Find dead code/assets, duplicate systems, stale runtime patches, accidental placeholders, oversized modules, brittle coupling, and unused dependencies.
- Do not perform speculative rewrites.
- Prioritize changes that reduce bug surface or speed up future development.

### Skill: `release-readiness-pass`
Use before public/demo/release builds.
Validate at minimum:
- boot/load
- complete menu flow
- settings
- keyboard/mouse where applicable
- controller where supported
- touch/mobile where supported
- save/persistence
- pause/resume
- game over / completion
- results
- retry
- return to menu
- audio
- accessibility
- representative performance
- debug/dev UI absence
- placeholder copy/assets absence
- credits/version accuracy
- build/CI status

Report failures separately as blockers, important follow-ups, or polish rather than claiming release readiness.

### Skill: `ui-copy-budget-pass`
Use whenever UI is created or redesigned.
- Every player-facing string must justify itself by communicating action, state, consequence, navigation, required instruction, or essential fiction already approved by the developer.
- Delete decorative explanatory copy by default.
- Never promote internal system names or development vocabulary into fiction automatically.
- If a screen works equally well without a string, omit it.

## Procedural visual authoring

For approved hard-surface visual assets in Three.js consumers, use the installed `img2threejs` skill when available. Treat it as an authoring-time reconstruction tool, not a runtime dependency.

Workflow:
1. Start from an approved reference image.
2. Run the real `img2threejs` staged reconstruction workflow and visual comparison gates.
3. Emit clean procedural Three.js/TypeScript factories (`THREE.Group`) with useful named pivots/sockets.
4. Integrate generated art through the consumer game's procedural visual registry/manifest rather than importing generated model files directly from gameplay logic.
5. Keep gameplay collision, targeting, state, and deterministic logic authoritative and separate from presentation geometry.
6. Preserve a simple fallback visual where appropriate.
7. Run the shell verification suite after shell changes.

The shell itself remains renderer-neutral. Do not add Three.js as a core runtime dependency solely for generated visuals; Three.js-specific procedural scaffolding belongs in generated Three.js games/adapters.
