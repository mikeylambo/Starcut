import type { SLUWebShell } from "../Shell.js";
import { ModuleRegistry } from "../modules/ModuleRegistry.js";
import type { FrameAssembly } from "./types.js";

export class AssemblyComposer {
  readonly modules = new ModuleRegistry();
  private assemblies: FrameAssembly[] = [];

  constructor(private readonly shell: SLUWebShell<any>) {}

  async add(assembly: FrameAssembly): Promise<this> {
    this.assemblies.push(assembly);
    for (const handle of assembly.modules) this.modules.registerShared(handle.id, handle.instance);
    await assembly.install();
    return this;
  }

  listAssemblies(): string[] { return this.assemblies.map((assembly) => assembly.id); }
}
