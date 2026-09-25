# Reusable Module Matrix

| Module | Arcade | Character Action | Arena | Vehicle | FPS | Puzzle | RPG | Strategy | Platformer | Party |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Training | ◐ | ✓ | ✓ | ◐ | ✓ | — | — | — | ✓ | ◐ |
| Ranking | ✓ | ✓ | ◐ | ✓ | ◐ | ✓ | ◐ | ◐ | ✓ | ◐ |
| Leaderboards | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ |
| Replay/Ghost | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | — | ◐ | ✓ | ✓ |
| Checkpoints | ◐ | ✓ | — | ◐ | ✓ | ◐ | ✓ | ◐ | ✓ | — |
| Loadout | ◐ | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | ◐ |
| Garage | — | — | — | ✓ | — | — | — | — | — | — |
| Inventory/Equipment | — | ◐ | ◐ | ◐ | ◐ | — | ✓ | ✓ | — | — |
| Economy | ◐ | ◐ | ◐ | ✓ | ◐ | — | ✓ | ✓ | — | — |
| Progression | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Player Assignment | — | — | ✓ | ◐ | ◐ | — | — | — | — | ✓ |
| Rulesets | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ |
| Waves | ✓ | ✓ | ✓ | — | ✓ | ◐ | ✓ | ✓ | — | ◐ |
| Dialogue/Quests | — | ◐ | — | — | ◐ | — | ✓ | ◐ | — | — |
| Move List | — | ✓ | ✓ | — | ✓ | — | ◐ | — | — | — |
| Results | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Simulation Speed | ◐ | ✓ | ◐ | ◐ | ◐ | — | ◐ | ✓ | ◐ | — |

`✓` common/default, `◐` useful depending on the game, `—` usually unnecessary.

## What remains game DNA

These modules intentionally do not implement:
- combat calculations
- player locomotion
- enemy AI
- vehicle physics
- renderer assets/materials
- world/level content
- game-specific scoring formulas
- networking transport/authority

The modules own reusable **state and workflow**, while the game supplies domain logic.
