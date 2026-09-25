import type { BuildInfo } from "../core/types.js";
import type { PlatformServices } from "../platform/PlatformServices.js";
import type { TelemetryRecorder } from "../telemetry/Telemetry.js";
import type { ProductionServices } from "../studio/ProductionServices.js";
import { createRunDescriptor,runMetadata,type RunDescriptor,type RunDescriptorInput } from "../game/RunDescriptor.js";
import { scheduledSeed,type SeedCadence } from "../game/ScheduledSeeds.js";

export interface SessionCoordinatorOptions{
  build:BuildInfo;
  platform:PlatformServices;
  telemetry:TelemetryRecorder;
  production:ProductionServices;
  flush?:()=>void|Promise<void>;
}
export interface StartRunOptions extends Omit<RunDescriptorInput,"gameId"|"version"|"runId"|"startedAt">{}
export interface EndRunOptions{
  outcome?:string;
  score?:number;
  leaderboard?:string;
  metadata?:Record<string,string|number|boolean>;
  presence?:string;
}

/** Coordinates the shared production/platform work around one authoritative run. */
export class ProductionSessionCoordinator{
  private run:RunDescriptor|null=null;
  constructor(private readonly options:SessionCoordinatorOptions){}

  get current():RunDescriptor|null{return this.run?structuredClone(this.run):null;}

  async start(input:StartRunOptions={}):Promise<RunDescriptor>{
    if(this.run)throw new Error(`Run already active: ${this.run.runId}`);
    this.run=createRunDescriptor({gameId:this.options.build.gameId,version:this.options.build.version,...input});
    const metadata=runMetadata(this.run);
    this.options.telemetry.setContext(metadata);
    this.options.telemetry.record("run.start",metadata);
    await this.options.platform.presence.setPresence("playing",this.presenceDetails(this.run));
    return structuredClone(this.run);
  }

  async startScheduled(cadence:SeedCadence,input:Omit<StartRunOptions,"seed"|"challengeKey">={},date=new Date()):Promise<RunDescriptor>{
    const scheduled=scheduledSeed(this.options.build.gameId,cadence,date);
    return this.start({...input,seed:scheduled.seed,challengeKey:scheduled.key,metadata:{...(input.metadata??{}),cadence}});
  }

  async unlockAchievement(id:string):Promise<boolean>{
    const unlocked=await this.options.production.achievements.unlock(id);
    if(unlocked)this.options.telemetry.record("run.achievement",{id,...this.requireRunMetadata()});
    return unlocked;
  }

  async end(result:EndRunOptions={}):Promise<RunDescriptor>{
    const run=this.requireRun();
    const metadata={...runMetadata(run),...(result.metadata??{})};
    this.options.telemetry.record("run.end",{...metadata,outcome:result.outcome??"complete",...(result.score===undefined?{}:{score:result.score})});
    if(result.leaderboard&&result.score!==undefined)await this.options.platform.leaderboards.submit(result.leaderboard,result.score,metadata);
    await this.options.flush?.();
    await this.options.platform.presence.setPresence(result.presence??"menu",{gameId:run.gameId});
    this.run=null;
    return structuredClone(run);
  }

  async abandon(reason="abandoned"):Promise<RunDescriptor>{return this.end({outcome:reason});}

  ghostMetadata(extra:Record<string,string|number|boolean>={}):Record<string,string|number|boolean>{
    return{...this.requireRunMetadata(),...extra};
  }

  private requireRun():RunDescriptor{if(!this.run)throw new Error("No active run");return this.run;}
  private requireRunMetadata():Record<string,string|number|boolean>{return runMetadata(this.requireRun());}
  private presenceDetails(run:RunDescriptor):Record<string,string>{
    return Object.fromEntries(Object.entries({mode:run.modeId,level:run.levelId,difficulty:run.difficultyId,challenge:run.challengeKey}).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]));
  }
}
