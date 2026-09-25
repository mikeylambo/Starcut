export class FocusManager {
  private items: HTMLElement[] = [];
  private index = -1;

  setItems(items: readonly HTMLElement[]): void {
    this.items = [...items].filter((x) => !x.hasAttribute("disabled"));
    this.index = this.items.length ? 0 : -1;
    this.focusCurrent();
  }

  next(): void {
    if (!this.items.length) return;
    this.index = (this.index + 1) % this.items.length;
    this.focusCurrent();
  }

  previous(): void {
    if (!this.items.length) return;
    this.index = (this.index - 1 + this.items.length) % this.items.length;
    this.focusCurrent();
  }

  focusCurrent(): void {
    this.items[this.index]?.focus();
  }
}
