---
name: slu-ui-copy-budget
description: Prevent unnecessary player-facing text, invented terminology, pseudo-lore, filler subtitles, and internal development language from leaking into game UI.
license: Apache-2.0
version: 1.0.0
---

# SLU UI Copy Budget

Use whenever creating or redesigning menus, HUD, onboarding, results, settings, mobile controls, tutorials, or transitions.

## Rule
Every player-facing string must justify itself by communicating action, state, consequence, navigation, required instruction, or essential fiction already approved by the developer.

## Workflow
1. Inventory every visible string added or changed by the task.
2. Delete text that merely fills space, brands an internal system, repeats visual information, or explains what the layout already communicates.
3. Never invent acronyms, OS/system labels, lore names, pseudo-technical vocabulary, slogans, decorative subtitles, or microcopy without approval.
4. Prefer iconography, hierarchy, animation, shape, sound, focus state, and empty space.
5. Keep development/debug labels clearly development-only and hidden from release UI.
6. When in doubt, leave the string out and preserve the visual space.

## Test
Ask: would the screen remain equally understandable without this string? If yes, omit it unless the developer explicitly wants the flavor text.
