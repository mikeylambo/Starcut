import type { BuildInfo } from "../core/types.js";
import type { RunDescriptor } from "../game/RunDescriptor.js";
import type { InputDeviceFamily } from "../input/InputGlyphs.js";

export interface PlaytestBundleExtras{
  run?:RunDescriptor|null;
  rng?:unknown;
  replay?:unknown;
  ghost?:unknown;
  game?:unknown;
  environment?:unknown;
  notes?:string;
}

export interface PlaytestBundleV1{
  schemaVersion:1;
  generatedAt:string;
  build:BuildInfo;
  runtime:{phase:string;levelId:string|null;inputFamily:InputDeviceFamily};
  settings:unknown;
  production:unknown;
  studio:unknown;
  run:RunDescriptor|null;
  rng?:unknown;
  replay?:unknown;
  ghost?:unknown;
  game?:unknown;
  environment?:unknown;
  notes?:string;
}

export interface PlaytestBundleInput extends PlaytestBundleExtras{
  build:BuildInfo;
  phase:string;
  levelId:string|null;
  inputFamily:InputDeviceFamily;
  settings:unknown;
  production:unknown;
  studio:unknown;
  clock?:()=>Date;
}

const clone=<T>(value:T):T=>{
  try{return structuredClone(value);}catch{return JSON.parse(JSON.stringify(value)) as T;}
};

/**
 * Creates one portable snapshot for crashes, bug reports and playtests.
 * Optional game-specific providers (RNG/replay/ghost/game state) remain opt-in,
 * while the shell-owned diagnostic surface is always present.
 */
export function createPlaytestBundle(input:PlaytestBundleInput):PlaytestBundleV1{
  const {build,phase,levelId,inputFamily,settings,production,studio,clock,...extras}=input;
  return{
    schemaVersion:1,
    generatedAt:(clock?.()??new Date()).toISOString(),
    build:clone(build),
    runtime:{phase,levelId,inputFamily},
    settings:clone(settings),
    production:clone(production),
    studio:clone(studio),
    run:extras.run?clone(extras.run):null,
    ...(extras.rng===undefined?{}:{rng:clone(extras.rng)}),
    ...(extras.replay===undefined?{}:{replay:clone(extras.replay)}),
    ...(extras.ghost===undefined?{}:{ghost:clone(extras.ghost)}),
    ...(extras.game===undefined?{}:{game:clone(extras.game)}),
    ...(extras.environment===undefined?{}:{environment:clone(extras.environment)}),
    ...(extras.notes===undefined?{}:{notes:extras.notes})
  };
}

export function exportPlaytestBundle(bundle:PlaytestBundleV1,pretty=true):string{
  return JSON.stringify(bundle,null,pretty?2:0);
}
