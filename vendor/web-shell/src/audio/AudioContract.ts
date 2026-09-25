export type AudioBusName = "master" | "music" | "sfx" | "ui" | string;

export interface AudioSystem {
  setBusVolume(bus: AudioBusName, value: number): void;
  setMuted(muted: boolean): void;
  pauseAll?(): void;
  resumeAll?(): void;
  playMusic?(id: string, options?: { loop?: boolean; fadeMs?: number }): void;
  playSfx?(id: string, options?: { volume?: number; pitch?: number }): void;
}
