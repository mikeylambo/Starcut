import { EventBus } from "../../core/EventBus.js";

export type CompanionPhase = "lobby" | "together" | "split" | "regroup" | "results";
export type CompanionViewMode = "shared" | "private";

export interface CompanionPublicPlayer {
  id: string;
  slot: number;
  displayName: string;
  ready: boolean;
  connected: boolean;
  view: CompanionViewMode;
  privateZoneId?: string;
}

export interface CompanionJoinReceipt extends CompanionPublicPlayer {
  reconnectToken: string;
}

export type CompanionAudience =
  | { kind: "all" }
  | { kind: "player"; playerId: string };

export interface CompanionMessage<T = unknown> {
  id: string;
  sequence: number;
  type: string;
  audience: CompanionAudience;
  payload: T;
  createdAt: number;
}

export interface CompanionAction<T = unknown> {
  playerId: string;
  type: string;
  payload: T;
  phase: CompanionPhase;
  view: CompanionViewMode;
  privateZoneId?: string;
  createdAt: number;
}

export interface CompanionClientView {
  roomCode: string;
  phase: CompanionPhase;
  player: CompanionJoinReceipt;
  players: CompanionPublicPlayer[];
  publicState: Record<string, unknown>;
  privateState: Record<string, unknown>;
  messages: CompanionMessage[];
}

export interface CompanionHostSnapshot {
  roomCode: string;
  phase: CompanionPhase;
  players: CompanionPublicPlayer[];
  publicState: Record<string, unknown>;
  privateStateByPlayer: Record<string, Record<string, unknown>>;
}

export interface CompanionSessionOptions {
  maxPlayers?: number;
  roomCode?: string;
  now?: () => number;
  reconnectTokenFactory?: (slot: number) => string;
  messageLimit?: number;
}

export interface CompanionSessionEvents {
  "companion:player-joined": CompanionPublicPlayer;
  "companion:player-disconnected": CompanionPublicPlayer;
  "companion:player-reconnected": CompanionPublicPlayer;
  "companion:player-left": CompanionPublicPlayer;
  "companion:player-ready": CompanionPublicPlayer;
  "companion:phase-changed": { previous: CompanionPhase; current: CompanionPhase };
  "companion:message": CompanionMessage;
  "companion:action": CompanionAction;
  "companion:public-state": { key: string; value: unknown };
  "companion:private-state": { playerId: string; key: string; value: unknown };
  [key: string]: unknown;
}

interface CompanionPlayerInternal extends CompanionPublicPlayer {
  deviceId: string;
  reconnectToken: string;
}

const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz";
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomString(length: number, alphabet: string): string {
  const values = new Uint32Array(length);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(values);
  else for (let i = 0; i < values.length; i++) values[i] = Math.floor(Math.random() * 0xffffffff);

  let result = "";
  for (const value of values) result += alphabet.charAt(value % alphabet.length);
  return result;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Host-authoritative state for shared-screen + personal-screen multiplayer.
 * Public truth and per-player private truth are stored separately by construction.
 */
export class CompanionSessionManager {
  readonly events = new EventBus<CompanionSessionEvents>();
  readonly roomCode: string;

  private readonly maxPlayers: number;
  private readonly now: () => number;
  private readonly reconnectTokenFactory: (slot: number) => string;
  private readonly messageLimit: number;
  private readonly players = new Map<string, CompanionPlayerInternal>();
  private readonly publicState: Record<string, unknown> = {};
  private readonly privateState = new Map<string, Record<string, unknown>>();
  private readonly messages: CompanionMessage[] = [];
  private phaseValue: CompanionPhase = "lobby";
  private messageSequence = 0;

  constructor(options: CompanionSessionOptions = {}) {
    this.maxPlayers = options.maxPlayers ?? 4;
    if (!Number.isInteger(this.maxPlayers) || this.maxPlayers < 1 || this.maxPlayers > 8) {
      throw new Error("Companion maxPlayers must be an integer from 1 to 8");
    }

    this.roomCode = options.roomCode?.trim().toUpperCase() || randomString(4, ROOM_ALPHABET);
    if (!/^[A-Z0-9]{4,8}$/.test(this.roomCode)) throw new Error("Companion roomCode must be 4-8 letters or numbers");

    this.now = options.now ?? (() => Date.now());
    this.reconnectTokenFactory = options.reconnectTokenFactory ?? (() => randomString(24, TOKEN_ALPHABET));
    this.messageLimit = options.messageLimit ?? 256;
    if (!Number.isInteger(this.messageLimit) || this.messageLimit < 1) throw new Error("Companion messageLimit must be positive");
  }

  phase(): CompanionPhase {
    return this.phaseValue;
  }

  join(deviceId: string, displayName?: string): CompanionJoinReceipt {
    const normalizedDeviceId = deviceId.trim();
    if (!normalizedDeviceId) throw new Error("Companion deviceId is required");

    const existing = [...this.players.values()].find((player) => player.deviceId === normalizedDeviceId);
    if (existing) {
      if (displayName?.trim()) existing.displayName = displayName.trim();
      if (!existing.connected) {
        existing.connected = true;
        this.events.emit("companion:player-reconnected", this.publicPlayer(existing));
      }
      return this.receipt(existing);
    }

    if (this.players.size >= this.maxPlayers) throw new Error("No companion player slots available");
    const slot = this.nextSlot();
    const player: CompanionPlayerInternal = {
      id: `player-${slot}`,
      slot,
      deviceId: normalizedDeviceId,
      displayName: displayName?.trim() || `P${slot}`,
      reconnectToken: this.reconnectTokenFactory(slot),
      ready: false,
      connected: true,
      view: "shared"
    };

    this.players.set(player.id, player);
    this.privateState.set(player.id, {});
    this.events.emit("companion:player-joined", this.publicPlayer(player));
    return this.receipt(player);
  }

  reconnect(reconnectToken: string, deviceId: string): CompanionJoinReceipt {
    const token = reconnectToken.trim();
    const nextDeviceId = deviceId.trim();
    if (!token || !nextDeviceId) throw new Error("Reconnect token and deviceId are required");

    const player = [...this.players.values()].find((candidate) => candidate.reconnectToken === token);
    if (!player) throw new Error("Unknown companion reconnect token");

    player.deviceId = nextDeviceId;
    player.connected = true;
    this.events.emit("companion:player-reconnected", this.publicPlayer(player));
    return this.receipt(player);
  }

  disconnect(playerId: string): CompanionPublicPlayer {
    const player = this.requirePlayer(playerId);
    player.connected = false;
    const snapshot = this.publicPlayer(player);
    this.events.emit("companion:player-disconnected", snapshot);
    return snapshot;
  }

  leave(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    this.players.delete(playerId);
    this.privateState.delete(playerId);
    this.events.emit("companion:player-left", this.publicPlayer(player));
    return true;
  }

  setReady(playerId: string, ready = true): CompanionPublicPlayer {
    const player = this.requirePlayer(playerId);
    player.ready = ready;
    const snapshot = this.publicPlayer(player);
    this.events.emit("companion:player-ready", snapshot);
    return snapshot;
  }

  allReady(minPlayers = 1): boolean {
    return this.players.size >= minPlayers && [...this.players.values()].every((player) => player.connected && player.ready);
  }

  start(minPlayers = 1): void {
    if (!this.allReady(minPlayers)) throw new Error("Companion session cannot start until all joined players are connected and ready");
    this.transition("together");
  }

  split(assignments: Partial<Record<string, string>>): void {
    if (this.phaseValue !== "together" && this.phaseValue !== "regroup") {
      throw new Error(`Companion session cannot split during ${this.phaseValue}`);
    }

    for (const playerId of Object.keys(assignments)) this.requirePlayer(playerId);
    let privatePlayers = 0;
    for (const player of this.players.values()) {
      const zone = assignments[player.id]?.trim();
      if (zone) {
        player.view = "private";
        player.privateZoneId = zone;
        privatePlayers++;
      } else {
        player.view = "shared";
        delete player.privateZoneId;
      }
    }
    if (privatePlayers === 0) throw new Error("Companion split requires at least one private player zone");
    this.transition("split");
  }

  regroup(): void {
    if (this.phaseValue !== "split") throw new Error(`Companion session cannot regroup during ${this.phaseValue}`);
    for (const player of this.players.values()) {
      player.view = "shared";
      delete player.privateZoneId;
    }
    this.transition("regroup");
  }

  resumeTogether(): void {
    if (this.phaseValue !== "regroup") throw new Error(`Companion session cannot resume together during ${this.phaseValue}`);
    this.transition("together");
  }

  finish(payload: unknown = null): void {
    this.broadcast("session:finished", payload);
    this.transition("results");
  }

  setPublicState(key: string, value: unknown): void {
    const normalizedKey = this.requireKey(key);
    this.publicState[normalizedKey] = clone(value);
    this.events.emit("companion:public-state", { key: normalizedKey, value: clone(value) });
  }

  setPrivateState(playerId: string, key: string, value: unknown): void {
    this.requirePlayer(playerId);
    const normalizedKey = this.requireKey(key);
    const state = this.privateState.get(playerId) ?? {};
    state[normalizedKey] = clone(value);
    this.privateState.set(playerId, state);
    this.events.emit("companion:private-state", { playerId, key: normalizedKey, value: clone(value) });
  }

  broadcast<T = unknown>(type: string, payload: T): CompanionMessage<T> {
    return this.pushMessage(type, { kind: "all" }, payload);
  }

  sendPrivate<T = unknown>(playerId: string, type: string, payload: T): CompanionMessage<T> {
    this.requirePlayer(playerId);
    return this.pushMessage(type, { kind: "player", playerId }, payload);
  }

  submitAction<T = unknown>(playerId: string, type: string, payload: T): CompanionAction<T> {
    const player = this.requireConnectedPlayer(playerId);
    const normalizedType = type.trim();
    if (!normalizedType) throw new Error("Companion action type is required");
    const action: CompanionAction<T> = {
      playerId,
      type: normalizedType,
      payload: clone(payload),
      phase: this.phaseValue,
      view: player.view,
      ...(player.privateZoneId ? { privateZoneId: player.privateZoneId } : {}),
      createdAt: this.now()
    };
    this.events.emit("companion:action", clone(action));
    return clone(action);
  }

  viewFor(playerId: string, afterSequence = 0): CompanionClientView {
    const player = this.requirePlayer(playerId);
    return {
      roomCode: this.roomCode,
      phase: this.phaseValue,
      player: this.receipt(player),
      players: this.listPlayers(),
      publicState: clone(this.publicState),
      privateState: clone(this.privateState.get(playerId) ?? {}),
      messages: this.messages
        .filter((message) => message.sequence > afterSequence && (message.audience.kind === "all" || message.audience.playerId === playerId))
        .map((message) => clone(message))
    };
  }

  hostSnapshot(): CompanionHostSnapshot {
    const privateStateByPlayer: Record<string, Record<string, unknown>> = {};
    for (const [playerId, state] of this.privateState) privateStateByPlayer[playerId] = clone(state);
    return {
      roomCode: this.roomCode,
      phase: this.phaseValue,
      players: this.listPlayers(),
      publicState: clone(this.publicState),
      privateStateByPlayer
    };
  }

  listPlayers(): CompanionPublicPlayer[] {
    return [...this.players.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((player) => this.publicPlayer(player));
  }

  private pushMessage<T>(type: string, audience: CompanionAudience, payload: T): CompanionMessage<T> {
    const normalizedType = type.trim();
    if (!normalizedType) throw new Error("Companion message type is required");
    const message: CompanionMessage<T> = {
      id: `message-${++this.messageSequence}`,
      sequence: this.messageSequence,
      type: normalizedType,
      audience: clone(audience),
      payload: clone(payload),
      createdAt: this.now()
    };
    this.messages.push(message as CompanionMessage);
    while (this.messages.length > this.messageLimit) this.messages.shift();
    this.events.emit("companion:message", clone(message));
    return clone(message);
  }

  private transition(next: CompanionPhase): void {
    if (this.phaseValue === next) return;
    const previous = this.phaseValue;
    this.phaseValue = next;
    this.events.emit("companion:phase-changed", { previous, current: next });
  }

  private nextSlot(): number {
    const used = new Set([...this.players.values()].map((player) => player.slot));
    for (let slot = 1; slot <= this.maxPlayers; slot++) if (!used.has(slot)) return slot;
    throw new Error("No companion player slots available");
  }

  private requirePlayer(playerId: string): CompanionPlayerInternal {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Unknown companion player: ${playerId}`);
    return player;
  }

  private requireConnectedPlayer(playerId: string): CompanionPlayerInternal {
    const player = this.requirePlayer(playerId);
    if (!player.connected) throw new Error(`Companion player is disconnected: ${playerId}`);
    return player;
  }

  private requireKey(key: string): string {
    const normalized = key.trim();
    if (!normalized) throw new Error("Companion state key is required");
    return normalized;
  }

  private publicPlayer(player: CompanionPlayerInternal): CompanionPublicPlayer {
    return clone({
      id: player.id,
      slot: player.slot,
      displayName: player.displayName,
      ready: player.ready,
      connected: player.connected,
      view: player.view,
      ...(player.privateZoneId ? { privateZoneId: player.privateZoneId } : {})
    });
  }

  private receipt(player: CompanionPlayerInternal): CompanionJoinReceipt {
    return { ...this.publicPlayer(player), reconnectToken: player.reconnectToken };
  }
}
