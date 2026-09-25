# create-slu-game

Example:

```bash
node tools/create-slu-game.mjs \
  --id airtime-2 \
  --name "Airtime 2" \
  --renderer three \
  --frames arcade,vehicle
```

Produces:

```text
airtime-2/
  index.html
  package.json
  src/main.ts
```

The generated project starts with:
- browser storage
- settings
- Shell
- renderer seam
- selected Frame assemblies
- selected reusable modules
- registered modes/difficulty
- boot flow

The renderer object is deliberately a seam rather than generated engine-specific gameplay code. The next adapter pass should replace this seam with concrete Three/Babylon/Phaser/Canvas boilerplate per renderer.
