import type { BuildInfo, JsonValue } from "../core/types.js";
import { TelemetryRecorder } from "../telemetry/Telemetry.js";
import { buildPlaytestReport } from "../telemetry/PlaytestReport.js";
import { RuntimeDiagnostics } from "../diagnostics/RuntimeDiagnostics.js";
import { DevConsoleRegistry } from "../debug/DevConsole.js";
import { LocalizationRegistry } from "../localization/Localization.js";
import { PlayerCopyCatalog } from "../localization/PlayerCopy.js";
import { AssetManifest } from "../assets/AssetManifest.js";
import { createNoopPlatformServices, type PlatformServices } from "../platform/PlatformServices.js";
import { RuntimeConfig, FeatureFlags, type RuntimeConfigValues } from "../config/RuntimeConfig.js";
import { FrameTimeSampler } from "../performance/PerformanceBudget.js";
import { CertificationRunner } from "../certification/Certification.js";

export interface StudioServicesOptions{
  platform?:PlatformServices;
  locale?:string;
  telemetryContext?:Record<string,JsonValue>;
  installGlobalDiagnostics?:boolean;
  configDefaults?:RuntimeConfigValues;
  configOverrides?:RuntimeConfigValues;
}

export class StudioServices{
  readonly telemetry:TelemetryRecorder;
  readonly diagnostics:RuntimeDiagnostics;
  readonly dev=new DevConsoleRegistry();
  readonly localization:LocalizationRegistry;
  readonly copy:PlayerCopyCatalog;
  readonly assets=new AssetManifest();
  readonly platform:PlatformServices;
  readonly config:RuntimeConfig;
  readonly features:FeatureFlags;
  readonly frameTimes=new FrameTimeSampler();
  readonly certification=new CertificationRunner();
  private stopDiagnostics:(()=>void)|null=null;
  constructor(readonly build:BuildInfo,private readonly options:StudioServicesOptions={}){
    this.telemetry=new TelemetryRecorder({context:{gameId:build.gameId,version:build.version,...(options.telemetryContext??{})}});
    this.diagnostics=new RuntimeDiagnostics(build);
    const locale=options.locale??"en";
    this.localization=new LocalizationRegistry({defaultLocale:locale,fallbackLocale:locale});
    this.copy=new PlayerCopyCatalog(this.localization,locale);
    this.platform=options.platform??createNoopPlatformServices();
    this.config=new RuntimeConfig(options.configDefaults,options.configOverrides);
    this.features=new FeatureFlags(this.config);
    this.dev.register("help",{description:"List registered commands",run:()=>this.dev.list().map(item=>`${item.name}${item.description?` — ${item.description}`:""}`).join("\n")});
    this.dev.register("telemetry.count",{description:"Show local telemetry event count",run:()=>String(this.telemetry.snapshot().length)});
    this.dev.register("telemetry.json",{description:"Export local telemetry JSON",run:()=>this.telemetry.exportJSON()});
    this.dev.register("playtest.report",{description:"Build local playtest report",run:()=>JSON.stringify(buildPlaytestReport(this.telemetry.snapshot()),null,2)});
    this.dev.register("diagnostics.count",{description:"Show diagnostic entry count",run:()=>String(this.diagnostics.snapshot().length)});
    this.dev.register("diagnostics.json",{description:"Export diagnostic report",run:()=>this.diagnostics.exportJSON()});
    this.dev.register("assets.audit",{description:"Validate semantic asset manifest",run:()=>{const issues=this.assets.validate();return issues.length?issues.join("\n"):"PASS";}});
    this.dev.register("copy.audit",{description:"Audit registered player-facing copy",run:()=>JSON.stringify(this.copy.audit(),null,2)});
    this.dev.register("config.json",{description:"Show active runtime config",run:()=>JSON.stringify(this.config.snapshot(),null,2)});
    this.dev.register("perf.summary",{description:"Show sampled frame-time summary",run:()=>JSON.stringify(this.frameTimes.summary(),null,2)});
    this.dev.registerPanel("Performance",{description:"Frame timing summary",read:()=>this.frameTimes.summary()});
    this.dev.registerPanel("Telemetry",{description:"Playtest analytics",read:()=>buildPlaytestReport(this.telemetry.snapshot())});
    this.dev.registerPanel("Diagnostics",{description:"Runtime errors and warnings",read:()=>this.diagnostics.report()});
    this.dev.registerPanel("Assets",{description:"Semantic asset manifest",read:()=>({issues:this.assets.validate(),assets:this.assets.list()})});
    this.dev.registerPanel("Copy",{description:"Player-facing copy audit",read:()=>this.copy.audit()});
    this.dev.registerPanel("Config",{description:"Runtime config and feature flags",read:()=>this.config.snapshot()});
  }
  start():void{
    if(typeof location!=="undefined")this.config.applyQuery(location.search);
    if(this.options.installGlobalDiagnostics!==false&&!this.stopDiagnostics)this.stopDiagnostics=this.diagnostics.installGlobalHandlers();
    this.telemetry.record("shell.boot");
  }
  stop():void{this.stopDiagnostics?.();this.stopDiagnostics=null;this.telemetry.record("shell.stop");}
  debugBundle():unknown{return{schemaVersion:1,build:this.build,generatedAt:new Date().toISOString(),config:this.config.snapshot(),telemetry:this.telemetry.snapshot(),playtest:buildPlaytestReport(this.telemetry.snapshot()),diagnostics:this.diagnostics.report(),assets:this.assets.list(),copy:this.copy.audit(),performance:this.frameTimes.summary()};}
  exportDebugBundle(pretty=true):string{return JSON.stringify(this.debugBundle(),null,pretty?2:0);}
}
