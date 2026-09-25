# SLU Web Shell 1.0 — Production Shell Acceptance

Version 1.0 defines "Layers 1 + 2 complete" as:

## Layer 1
- lifecycle/session
- event bus
- semantic keyboard/mouse/gamepad input
- raw pointer-look support
- localStorage + IndexedDB persistence
- versioned/chained save migration
- settings
- accessibility contract
- stats, achievements
- modes, objectives, challenges, rewards, unlocks, difficulty
- content registry
- audio contract
- screen/focus management
- debug state
- renderer-neutral contract and adapters

## Layer 2
Ten composable genre Frames with executable Assemblies:
- Arcade
- Character Action
- Arena Combat
- Vehicle
- FPS
- Puzzle
- RPG
- Strategy/TD
- Platformer
- Party/Multiplayer

## Reusable modules
- results
- rankings
- leaderboards
- replay
- ghosts
- training
- checkpoints
- loadouts/garage
- inventory
- economy
- waves
- player assignment
- simulation speed

## UI shell
Generated games boot with:
- Title
- Main Menu
- Mode Select
- Difficulty Select
- Stage Select
- Character Select
- Vehicle Select
- Loadout
- Challenge Select
- Settings
- Pause
- Results
- Credits

UI supports mouse, keyboard and standard gamepad navigation via semantic actions.

## Generator
`create-slu-game` creates a runnable Vite/TypeScript webgame project with selected renderer + Frames already assembled.

After generation, only Game DNA and game-specific presentation/content should be missing.

## Runtime lifecycle
- renderer resize wiring
- browser visibility auto-pause
- persistent interactive core settings
- composed setup flow traverses all applicable selectors before gameplay
