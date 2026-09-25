# Layer 1 — SLU Web Shell Specification

## Tier 0: required in every webgame

- App/game lifecycle
- Event bus
- Session state
- Semantic input actions
- Settings persistence
- Save/profile persistence
- Audio settings contract
- UI navigation events
- Pause/resume/restart/quit flow
- Browser focus/visibility handling
- Fullscreen hooks
- Accessibility state
- Stats
- Version/build metadata
- Debug state

## Universal game systems

These are implemented in Layer 1 because they recur across genres:

- Mode definitions
- Objectives
- Challenges
- Difficulty profiles
- Rewards
- Unlocks
- Achievements/hooks
- Content registry

Layer 2 controls **presentation and default recipes**, not the underlying storage model.

## Non-goals

Layer 1 does not contain:

- player movement
- combat
- vehicle physics
- enemy AI
- world geometry
- renderer-specific materials
- game-specific HUD semantics
- story content
- genre baggage such as crafting by default

## Runtime adapter principle

A renderer adapter should implement lifecycle and presentation seams only:

- resize
- suspend/resume rendering
- transition/fade
- load/unload scene/level
- screenshot
- debug visualization hook

It should not own progression, settings, save data or challenge logic.
