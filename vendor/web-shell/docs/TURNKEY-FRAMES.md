# Turnkey Frames — v0.3

A Frame is now more than metadata.

Each **Assembly**:
1. Instantiates the reusable modules expected by that genre.
2. Registers its modes and difficulty profiles into the Shell.
3. Exposes the instantiated modules through `AssemblyComposer.modules`.

Example:

```ts
const composer = new AssemblyComposer(shell);

await composer.add(createArcadeAssembly({ shell }));
await composer.add(createVehicleAssembly({ shell }));

const ghost = composer.modules.get<GhostManager>("ghost");
const results = composer.modules.get<ResultManager>("results");
```

Duplicate modules are intentionally shared by first registration. This means composable Frames do not create three competing ResultManagers or LeaderboardManagers.

## Default bundles

### Arcade
Results, ranking, leaderboards, replay, ghost.

### Character Action
Training, results, ranking, checkpoints, simulation speed.

### Arena Combat
Training, results, local player assignment, simulation speed.

### Vehicle
Garage/loadout, results, leaderboards, replay, ghost.

### FPS
Training, checkpoints, loadout, results, leaderboards.

### Puzzle
Results, leaderboards, checkpoints.

### RPG
Inventory, equipment/loadout, economy, checkpoints, results.

### Strategy
Waves, loadout, economy, results, simulation speed.

### Platformer
Checkpoints, results, leaderboards, replay, ghost.

### Party / Multiplayer
Player assignment, results.
