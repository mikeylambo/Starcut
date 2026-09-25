# SLU integration reference

## Preferred structure

```text
src/art/procedural/
  ProceduralVisualRegistry.ts
  visualManifest.ts
  models/
    createApprovedAssetModel.ts
```

Gameplay asks for a semantic visual key. It does not import generated art directly.

## Safe attachment

The authoritative gameplay object owns collision, hit detection, gameplay transforms, state, and save identity.

The generated visual owns rendered geometry, presentation materials, presentation-only animation, and named sockets/pivots.

Never let a generated child mesh become authoritative merely because it is visually more detailed.

## Traversal FPS

Current production pattern:

```ts
registerProceduralVisual("weapon.warp-rifle.default", {
  factory: createWarpRifleModel,
  update: updateWarpRifleModel,
  tier: "hero"
});
```

A newly reconstructed Warp Rifle should replace the factory behind that same key rather than changing gameplay systems.

## Platform fighter

Keep deterministic simulation authoritative. Procedural visuals belong in presentation only unless a separate authored gameplay contract explicitly says otherwise.

## New Web Shell games

Three.js games should scaffold a visual registry/manifest and keep the renderer-neutral shell free of Three.js-specific gameplay dependencies.
