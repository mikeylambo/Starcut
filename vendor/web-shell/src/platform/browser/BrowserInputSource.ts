import type { InputAction, InputBinding } from "../../input/InputTypes.js";

export class BrowserInputSource {
  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private connected = false;

  constructor(private readonly bindings: readonly InputBinding[]) {}

  attach(target: Window = window): () => void {
    if (this.connected) return () => {};
    this.connected = true;

    const keyDown = (e: KeyboardEvent) => this.keys.add(e.code);
    const keyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const mouseDown = (e: MouseEvent) => this.mouseButtons.add(e.button);
    const mouseUp = (e: MouseEvent) => this.mouseButtons.delete(e.button);
    const blur = () => {
      this.keys.clear();
      this.mouseButtons.clear();
    };

    target.addEventListener("keydown", keyDown);
    target.addEventListener("keyup", keyUp);
    target.addEventListener("mousedown", mouseDown);
    target.addEventListener("mouseup", mouseUp);
    target.addEventListener("blur", blur);

    return () => {
      target.removeEventListener("keydown", keyDown);
      target.removeEventListener("keyup", keyUp);
      target.removeEventListener("mousedown", mouseDown);
      target.removeEventListener("mouseup", mouseUp);
      target.removeEventListener("blur", blur);
      this.connected = false;
    };
  }

  poll(): Map<InputAction, number> {
    const values = new Map<InputAction, number>();
    const pads = navigator.getGamepads?.() ?? [];

    for (const binding of this.bindings) {
      let value = 0;

      if (binding.keyboard?.some((code) => this.keys.has(code))) value = 1;
      if (binding.mouseButtons?.some((button) => this.mouseButtons.has(button))) value = 1;

      for (const pad of pads) {
        if (!pad) continue;
        if (binding.gamepadButtons?.some((button) => pad.buttons[button]?.pressed)) value = 1;

        for (const axisBinding of binding.gamepadAxes ?? []) {
          const axis = pad.axes[axisBinding.axis] ?? 0;
          const threshold = axisBinding.threshold ?? 0.35;
          const directed = axis * axisBinding.direction;
          if (directed >= threshold) value = Math.max(value, directed);
        }
      }

      values.set(binding.action, value);
    }

    return values;
  }
}
