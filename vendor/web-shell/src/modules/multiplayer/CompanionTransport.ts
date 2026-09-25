import type { Unsubscribe } from "../../core/types.js";

export interface CompanionTransportPacket<T = unknown> {
  senderId: string;
  targetId?: string;
  type: string;
  payload: T;
}

export interface CompanionTransport {
  readonly endpointId: string;
  send<T = unknown>(packet: Omit<CompanionTransportPacket<T>, "senderId">): void | Promise<void>;
  onMessage(listener: (packet: CompanionTransportPacket) => void): Unsubscribe;
  close(): void | Promise<void>;
}

interface LoopbackEndpointState {
  listeners: Set<(packet: CompanionTransportPacket) => void>;
  closed: boolean;
}

/**
 * Dependency-free relay used by tests, local prototypes and same-page controller previews.
 * Production games can implement CompanionTransport with WebSocket/WebRTC without changing
 * any session or game rules.
 */
export class LoopbackCompanionHub {
  private endpoints = new Map<string, LoopbackEndpointState>();

  connect(endpointId: string): CompanionTransport {
    const id = endpointId.trim();
    if (!id) throw new Error("Companion endpoint id is required");
    if (this.endpoints.has(id)) throw new Error(`Companion endpoint already connected: ${id}`);

    const state: LoopbackEndpointState = { listeners: new Set(), closed: false };
    this.endpoints.set(id, state);

    return {
      endpointId: id,
      send: (packet) => {
        if (state.closed) throw new Error(`Companion endpoint is closed: ${id}`);
        this.dispatch({ ...structuredClone(packet), senderId: id });
      },
      onMessage: (listener) => {
        if (state.closed) throw new Error(`Companion endpoint is closed: ${id}`);
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
      },
      close: () => {
        if (state.closed) return;
        state.closed = true;
        state.listeners.clear();
        this.endpoints.delete(id);
      }
    };
  }

  connectedEndpointIds(): string[] {
    return [...this.endpoints.keys()];
  }

  private dispatch(packet: CompanionTransportPacket): void {
    if (packet.targetId) {
      const target = this.endpoints.get(packet.targetId);
      if (!target || target.closed) return;
      for (const listener of target.listeners) listener(structuredClone(packet));
      return;
    }

    for (const [endpointId, target] of this.endpoints) {
      if (endpointId === packet.senderId || target.closed) continue;
      for (const listener of target.listeners) listener(structuredClone(packet));
    }
  }
}
