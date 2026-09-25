import type { GenreFrame } from "../frames/types.js";
import type { SLUWebShell } from "../Shell.js";
export interface ModuleHandle {
  id: string;
  instance: unknown;
}

export interface FrameAssemblyContext {
  shell: SLUWebShell<any>;
}

export interface FrameAssembly {
  id: string;
  frame: GenreFrame;
  modules: ModuleHandle[];
  install(): void | Promise<void>;
}

export type AssemblyFactory = (context: FrameAssemblyContext) => FrameAssembly;
