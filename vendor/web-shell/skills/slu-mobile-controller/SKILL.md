---
name: slu-mobile-controller
description: Make touch and controller first-class interaction modes across the complete player loop using one semantic input layer.
license: Apache-2.0
version: 1.0.0
---

# SLU Mobile + Controller Parity

Use when a game supports or is adding touch, mobile, or gamepad.

## Semantic input rule
Keyboard/mouse, gamepad, and touch map into shared gameplay actions. Gameplay code should not branch on device unless the interaction itself genuinely differs.

## Mobile workflow
- validate thumb zones, safe areas, landscape/portrait strategy, tap target size, gesture conflicts, browser audio unlock, touch-action/pointer behavior, HUD density, readable text, thermal/performance pressure, and orientation changes;
- redesign interaction rather than shrinking desktop UI;
- preserve the full game rather than creating a reduced mobile-lite version unless explicitly requested.

## Controller workflow
- verify obvious focus, sensible default focus, no focus traps, no duplicate activation, and correct input-mode switching;
- ensure every screen and modal works without mouse/keyboard.

## Required end-to-end test
Boot → menus → settings → game start → gameplay → pause/resume → results/failure → retry → return to menu using only the target device.
