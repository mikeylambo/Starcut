import { EventBus } from "../core/EventBus.js";

export interface PointerDelta {
  x: number;
  y: number;
  movementX: number;
  movementY: number;
}

export interface PointerLookEvents {
  delta: PointerDelta;
  lockchange: { locked: boolean };
  [key: string]: unknown;
}

/**
 * Raw relative pointer stream for FPS/camera look.
 * Kept separate from semantic action values because mouse deltas are unbounded
 * per-frame motion, not normalized [-1,1] button/axis state.
 */
export class PointerLook {
  readonly events = new EventBus<PointerLookEvents>();
  private dx = 0;
  private dy = 0;
  private attached = false;

  constructor(private readonly target: HTMLElement) {}

  attach(): () => void {
    if (this.attached) return () => {};
    this.attached = true;

    const move = (event: MouseEvent) => {
      if (document.pointerLockElement !== this.target) return;
      this.dx += event.movementX;
      this.dy += event.movementY;
      this.events.emit("delta", {
        x: this.dx, y: this.dy,
        movementX: event.movementX,
        movementY: event.movementY
      });
    };
    const lock = () => this.events.emit("lockchange", {
      locked: document.pointerLockElement === this.target
    });

    document.addEventListener("mousemove", move);
    document.addEventListener("pointerlockchange", lock);

    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("pointerlockchange", lock);
      this.attached = false;
      this.dx = 0; this.dy = 0;
    };
  }

  requestLock(): void {
    this.target.requestPointerLock?.();
  }

  consume(): { x: number; y: number } {
    const result = { x: this.dx, y: this.dy };
    this.dx = 0; this.dy = 0;
    return result;
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }
}
