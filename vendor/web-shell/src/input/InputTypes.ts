export type InputAction = string;

export interface ActionState {
  value: number;
  down: boolean;
  pressed: boolean;
  released: boolean;
}

export interface InputBinding {
  action: InputAction;
  keyboard?: string[];
  mouseButtons?: number[];
  gamepadButtons?: number[];
  gamepadAxes?: Array<{
    axis: number;
    direction: -1 | 1;
    threshold?: number;
  }>;
}
