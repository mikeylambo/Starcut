import { EventBus } from "../../core/EventBus.js";

export interface EconomyEvents {
  "currency:changed": { id: string; balance: number; delta: number };
  [key: string]: unknown;
}

export class EconomyManager {
  readonly events = new EventBus<EconomyEvents>();
  private balances = new Map<string, number>();

  balance(id: string): number { return this.balances.get(id) ?? 0; }

  credit(id: string, amount: number): number {
    this.assertAmount(amount);
    return this.change(id, amount);
  }

  canAfford(id: string, amount: number): boolean {
    this.assertAmount(amount);
    return this.balance(id) >= amount;
  }

  trySpend(id: string, amount: number): boolean {
    this.assertAmount(amount);
    if (!this.canAfford(id, amount)) return false;
    this.change(id, -amount);
    return true;
  }

  spend(id: string, amount: number): number {
    if (!this.trySpend(id, amount)) throw new Error(`Insufficient ${id}`);
    return this.balance(id);
  }

  set(id: string, amount: number): number {
    if (!Number.isFinite(amount)) throw new Error("Currency balance must be finite");
    const old = this.balance(id);
    this.balances.set(id, amount);
    this.events.emit("currency:changed", { id, balance: amount, delta: amount - old });
    return amount;
  }

  private change(id: string, delta: number): number {
    const next = this.balance(id) + delta;
    this.balances.set(id, next);
    this.events.emit("currency:changed", { id, balance: next, delta });
    return next;
  }

  private assertAmount(amount: number): void {
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Amount must be a finite number >= 0");
  }
}
