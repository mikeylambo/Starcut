import type { ActionState, InputAction, InputBinding } from "./InputTypes.js";

const emptyState = (): ActionState => ({
  value: 0,
  down: false,
  pressed: false,
  released: false
});

export class InputManager {
  private states = new Map<InputAction, ActionState>();
  private previousDown = new Map<InputAction, boolean>();
  private bindings = new Map<InputAction, InputBinding>();

  setBindings(bindings: readonly InputBinding[]): void {
    this.bindings.clear();
    for (const binding of bindings) {
      this.bindings.set(binding.action, structuredClone(binding));
      if (!this.states.has(binding.action)) this.states.set(binding.action, emptyState());
    }
  }

  actions(): readonly InputAction[] {
    return [...this.bindings.keys()];
  }

  get(action: InputAction): Readonly<ActionState> {
    return this.states.get(action) ?? emptyState();
  }

  isDown(action: InputAction): boolean {
    return this.get(action).down;
  }

  value(action: InputAction): number {
    return this.get(action).value;
  }

  wasPressed(action: InputAction): boolean {
    return this.get(action).pressed;
  }

  wasReleased(action: InputAction): boolean {
    return this.get(action).released;
  }

  update(raw: Map<InputAction, number>): void {
    for (const action of this.bindings.keys()) {
      const value = Math.max(-1, Math.min(1, raw.get(action) ?? 0));
      const down = Math.abs(value) > 0.001;
      const previous = this.previousDown.get(action) ?? false;
      this.states.set(action, {
        value,
        down,
        pressed: down && !previous,
        released: !down && previous
      });
      this.previousDown.set(action, down);
    }
  }
}
