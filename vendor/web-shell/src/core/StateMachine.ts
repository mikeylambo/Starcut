export interface Transition<S extends string> {
  from: S;
  to: S;
}

export class StateMachine<S extends string> {
  private state: S;
  private allowed = new Map<S, Set<S>>();

  constructor(initial: S, transitions: readonly Transition<S>[] = []) {
    this.state = initial;
    for (const { from, to } of transitions) {
      const targets = this.allowed.get(from) ?? new Set<S>();
      targets.add(to);
      this.allowed.set(from, targets);
    }
  }

  get current(): S {
    return this.state;
  }

  can(to: S): boolean {
    const targets = this.allowed.get(this.state);
    return !targets || targets.size === 0 || targets.has(to);
  }

  transition(to: S): S {
    if (!this.can(to)) {
      throw new Error(`Illegal state transition: ${this.state} -> ${to}`);
    }
    this.state = to;
    return this.state;
  }
}
