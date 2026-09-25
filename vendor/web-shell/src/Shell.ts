import { EventBus } from "./core/EventBus.js";
import { GameSession } from "./core/GameSession.js";
import type { BuildInfo } from "./core/types.js";
import { InputManager } from "./input/InputManager.js";
import { ModeManager } from "./game/Modes.js";
import { ObjectiveManager } from "./game/Objectives.js";
import { ChallengeManager } from "./game/Challenges.js";
import { DifficultyManager } from "./game/Difficulty.js";
import { RewardManager } from "./game/Rewards.js";
import { UnlockManager } from "./game/UnlockManager.js";
import { StatsManager } from "./game/StatsManager.js";
import { ContentRegistry } from "./content/ContentRegistry.js";
import type { RendererAdapter } from "./adapters/RendererAdapter.js";
import type { SettingsStore } from "./persistence/SettingsStore.js";
import { StudioServices, type StudioServicesOptions } from "./studio/StudioServices.js";
import { ProductionServices,type ProductionServicesOptions } from "./studio/ProductionServices.js";
import { createPlaytestBundle,exportPlaytestBundle as serializePlaytestBundle,type PlaytestBundleExtras,type PlaytestBundleV1 } from "./diagnostics/PlaytestBundle.js";

export interface ShellEvents {
  "game:pause":undefined;"game:resume":undefined;"game:restart":undefined;"game:quit":undefined;
  "game:error":{scope:string;error:unknown};
  "level:load":{id:string;payload?:unknown};"level:loaded":{id:string};[key:string]:unknown;
}
export interface ShellOptions<TSettings extends object>{
  build:BuildInfo;renderer:RendererAdapter;settings:SettingsStore<TSettings>;unlocks?:UnlockManager;stats?:StatsManager;studio?:StudioServicesOptions;production?:ProductionServicesOptions;
}
export class SLUWebShell<TSettings extends object>{
  readonly events=new EventBus<ShellEvents>();readonly session=new GameSession();readonly input=new InputManager();
  readonly modes=new ModeManager();readonly objectives=new ObjectiveManager();readonly challenges=new ChallengeManager();
  readonly difficulty=new DifficultyManager();readonly rewards=new RewardManager();readonly unlocks:UnlockManager;
  readonly stats:StatsManager;readonly content=new ContentRegistry();readonly studio:StudioServices;readonly production:ProductionServices;
  private lastLevelId:string|null=null;
  constructor(readonly options:ShellOptions<TSettings>){
    this.unlocks=options.unlocks??new UnlockManager();this.stats=options.stats??new StatsManager();this.studio=new StudioServices(options.build,options.studio);this.production=new ProductionServices(options.production);
    this.session.events.on("phase:changed",({from,to})=>this.studio.telemetry.record("session.phase",{from,to}));
    this.session.events.on("session:ended",({durationMs})=>this.studio.telemetry.record("session.end",{durationMs}));
    this.production.achievements.events.on("achievement:unlocked",achievement=>this.studio.telemetry.record("achievement.unlocked",{id:achievement.id}));
    this.production.narrative.events.on("narrative:start",({sequenceId})=>this.studio.telemetry.record("narrative.start",{sequenceId}));
    this.production.narrative.events.on("narrative:end",({sequenceId,skipped})=>this.studio.telemetry.record("narrative.end",{sequenceId,skipped}));
    this.production.codex.events.on("codex:unlocked",entry=>this.studio.telemetry.record("codex.unlocked",{id:entry.id,category:entry.category}));
    this.production.photo.events.on("photo:capture",()=>this.studio.telemetry.record("photo.capture"));
    this.production.notifications.events.on("notification:show",item=>this.studio.telemetry.record("notification.show",{id:item.id,kind:item.kind}));
    this.production.transitions.events.on("transition:start",item=>this.studio.telemetry.record("transition.start",{id:item.id,kind:item.kind}));
    this.production.transitions.events.on("transition:end",({id})=>this.studio.telemetry.record("transition.end",{id}));
    this.production.cinematics.events.on("cinematic:directive",directive=>this.studio.telemetry.record("cinematic.directive",{kind:directive.kind}));
    this.production.onboarding.events.on("onboarding:lesson",({flowId,lesson,index})=>this.studio.telemetry.record("onboarding.lesson",{flowId:flowId??"contextual",lessonId:lesson.id,index}));
    this.production.onboarding.events.on("onboarding:flow-complete",({flowId})=>this.studio.telemetry.record("onboarding.complete",{flowId}));
    this.production.onboarding.events.on("onboarding:flow-skip",({flowId})=>this.studio.telemetry.record("onboarding.skip",{flowId}));
    this.studio.dev.register("state.phase",{description:"Show active game phase",run:()=>this.session.phase});
    this.studio.dev.register("state.build",{description:"Show build metadata",run:()=>JSON.stringify(this.build,null,2)});
    this.studio.dev.register("state.level",{description:"Show last loaded level id",run:()=>this.lastLevelId??"none"});
    this.studio.dev.register("state.settings",{description:"Show active settings snapshot",run:()=>JSON.stringify(this.settings.snapshot(),null,2)});
    this.studio.dev.register("state.production",{description:"Show reusable production service state",run:()=>JSON.stringify({entitlement:this.production.entitlements.current,narrative:this.production.narrative.sequenceId,codex:this.production.codex.snapshot(),photo:this.production.photo.snapshot(),transition:this.production.transitions.current,notifications:this.production.notifications.list(),onboarding:{flowId:this.production.onboarding.flowId,current:this.production.onboarding.current?.id??null,state:this.production.onboarding.snapshot()}},null,2)});
    this.studio.dev.register("playtest.bundle",{description:"Export the unified shell crash/playtest bundle",run:()=>this.exportPlaytestBundle()});
    this.studio.dev.register("game.pause",{description:"Pause active gameplay",run:()=>this.pause()});
    this.studio.dev.register("game.resume",{description:"Resume paused gameplay",run:()=>this.resume()});
    this.studio.dev.register("game.restart",{description:"Emit the game restart request",run:()=>this.restart()});
    this.studio.dev.register("game.quit",{description:"Return the shell to menu state",run:()=>this.quit()});
    this.studio.dev.register("level.load",{description:"Load a level by id",run:async({args})=>{const id=args[0];if(!id)throw new Error("Usage: level.load <id>");await this.loadLevel(id);return `loaded ${id}`;}});
    this.studio.dev.registerPanel("State",{description:"Shell, build, settings and level state",read:()=>({phase:this.session.phase,levelId:this.lastLevelId,build:this.build,settings:this.settings.snapshot()})});
    this.studio.dev.registerPanel("Input",{description:"Semantic input actions",read:()=>Object.fromEntries(this.input.actions().map(action=>[action,this.input.get(action)]))});
    this.studio.dev.registerPanel("Production",{description:"Narrative, entitlement, codex, onboarding, photo and presentation state",read:()=>({entitlement:this.production.entitlements.current,narrative:{active:this.production.narrative.isActive,sequenceId:this.production.narrative.sequenceId,beat:this.production.narrative.current?.id??null},codex:this.production.codex.snapshot(),onboarding:{flowId:this.production.onboarding.flowId,current:this.production.onboarding.current?.id??null,state:this.production.onboarding.snapshot()},photo:this.production.photo.snapshot(),transition:this.production.transitions.current,notifications:this.production.notifications.list()})});
  }
  get build():BuildInfo{return this.options.build;} get renderer():RendererAdapter{return this.options.renderer;}
  get settings():SettingsStore<TSettings>{return this.options.settings;}
  capturePlaytestBundle(extras:PlaytestBundleExtras={}):PlaytestBundleV1{
    return createPlaytestBundle({
      build:this.build,
      phase:this.session.phase,
      levelId:this.lastLevelId,
      inputFamily:this.production.glyphs.activeFamily,
      settings:this.settings.snapshot(),
      production:this.production.snapshotState(),
      studio:this.studio.debugBundle(),
      ...extras
    });
  }
  exportPlaytestBundle(extras:PlaytestBundleExtras={},pretty=true):string{return serializePlaytestBundle(this.capturePlaytestBundle(extras),pretty);}
  async boot():Promise<void>{
    this.session.start();this.studio.start();
    try{this.session.setPhase("title");await this.renderer.start?.();}
    catch(error){this.fail("boot",error);throw error;}
  }
  pause():void{const before=this.session.phase;this.session.pause();if(this.session.phase===before)return;this.renderer.suspend?.();this.studio.telemetry.record("game.pause");this.events.emit("game:pause",undefined);}
  resume():void{const before=this.session.phase;this.session.resume();if(this.session.phase===before)return;this.renderer.resume?.();this.studio.telemetry.record("game.resume");this.events.emit("game:resume",undefined);}
  async loadLevel(id:string,payload?:unknown):Promise<void>{
    this.lastLevelId=id;this.session.setPhase("loading");this.studio.telemetry.record("level.load",{levelId:id});this.events.emit("level:load",{id,payload});
    try{await this.renderer.loadLevel?.(id,payload);this.session.setPhase("playing");this.studio.telemetry.record("level.loaded",{levelId:id});this.events.emit("level:loaded",{id});}
    catch(error){this.fail("level.load",error,{levelId:id});throw error;}
  }
  restart():void{this.studio.telemetry.record("game.restart",this.lastLevelId?{levelId:this.lastLevelId}:{});this.events.emit("game:restart",undefined);}
  quit():void{
    this.studio.telemetry.record("game.quit",this.lastLevelId?{levelId:this.lastLevelId}:{});this.events.emit("game:quit",undefined);this.session.setPhase("menu");
    try{const pending=this.renderer.unloadLevel?.();if(pending instanceof Promise)void pending.catch(error=>this.fail("level.unload",error));}catch(error){this.fail("level.unload",error);}
    this.lastLevelId=null;
  }
  async dispose():Promise<void>{this.session.end();this.studio.stop();await this.renderer.dispose?.();}
  private fail(scope:string,error:unknown,context:Record<string,string|number|boolean>={}):void{
    this.studio.diagnostics.capture(error,{scope,...context});
    this.studio.telemetry.record("runtime.error",{scope,message:error instanceof Error?error.message:String(error),...context});
    try{this.session.setPhase("error");}catch{ /* preserve the original failure */ }
    this.events.emit("game:error",{scope,error});
  }
}
