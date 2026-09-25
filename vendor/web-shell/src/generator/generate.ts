import type { GameScaffoldConfig } from "./types.js";

const assemblyFactoryByFrame: Record<string, string> = {
  "arcade": "createArcadeAssembly",
  "character-action": "createCharacterActionAssembly",
  "arena-combat": "createArenaCombatAssembly",
  "vehicle": "createVehicleAssembly",
  "fps": "createFPSAssembly",
  "puzzle": "createPuzzleAssembly",
  "rpg": "createRPGAssembly",
  "strategy": "createStrategyAssembly",
  "platformer": "createPlatformerAssembly",
  "party-multiplayer": "createPartyMultiplayerAssembly"
};

const adapterByRenderer: Record<string, string> = {
  three: "createThreeStarterAdapter",
  babylon: "createBabylonStarterAdapter",
  phaser: "PhaserAdapter",
  canvas2d: "createCanvas2DStarterAdapter",
  dom: "createDOMStarterAdapter"
};

export function generateGameSource(config: GameScaffoldConfig): string {
  const factories = config.frames.map((frame) => assemblyFactoryByFrame[frame]);
  if (factories.some((factory) => !factory)) throw new Error("Unknown frame in scaffold config");
  const adapter = adapterByRenderer[config.renderer];
  if (!adapter) throw new Error(`Unknown renderer: ${config.renderer}`);

  const rendererLine = config.renderer === "dom"
    ? `const rendererAdapter = createDOMStarterAdapter(document.getElementById("game")!);`
    : config.renderer === "phaser"
      ? `const rendererAdapter = new PhaserAdapter();`
      : `const rendererAdapter = ${adapter}(document.getElementById("game-canvas") as HTMLCanvasElement);`;

  return `import {
  createGameApp,
  ${[...factories, adapter].join(",\n  ")}
} from "@slu/web-shell";

${rendererLine}

export const app = await createGameApp({
  gameId: "${config.gameId}",
  gameName: "${config.gameName}",
  version: "0.1.0",
  renderer: rendererAdapter,
  root: document.getElementById("ui")!,
  assemblies: [
    ${factories.map((factory) => `(shell) => ${factory}({ shell })`).join(",\n    ")}
  ]
});
`;
}
