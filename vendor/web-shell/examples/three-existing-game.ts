import {
  BrowserStorage,
  SettingsStore,
  SLUWebShell,
  ThreeAdapter
} from "@slu/web-shell";

const storage = new BrowserStorage("my-game");
const settings = SettingsStore.core(storage);

const adapter = new ThreeAdapter({
  onSuspend: () => {
    // Existing Three.js loop: stop simulation updates.
  },
  onResume: () => {
    // Resume simulation.
  },
  onResize: (width, height, dpr) => {
    // renderer.setPixelRatio(...)
    // renderer.setSize(...)
    // camera.aspect = width / height
  },
  onLoadLevel: async (id) => {
    // Call the game's EXISTING scene/level loader.
    console.log("load existing level", id);
  }
});

export const shell = new SLUWebShell({
  build: {
    gameId: "my-game",
    gameName: "My Game",
    version: "0.1.0"
  },
  renderer: adapter,
  settings
});
