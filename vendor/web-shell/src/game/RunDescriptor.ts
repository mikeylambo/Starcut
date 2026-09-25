import { stableHashString } from "../core/DeterministicRNG.js";

export interface RunDescriptor {
  schemaVersion:1;
  runId:string;
  gameId:string;
  version:string;
  modeId?:string;
  levelId?:string;
  difficultyId?:string;
  seed?:string|number;
  challengeKey?:string;
  startedAt:string;
  metadata?:Record<string,string|number|boolean>;
}

export interface RunDescriptorInput extends Omit<RunDescriptor,"schemaVersion"|"runId"|"startedAt">{
  runId?:string;
  startedAt?:string;
}

export function createRunDescriptor(input:RunDescriptorInput):RunDescriptor{
  const startedAt=input.startedAt??new Date().toISOString();
  const identity=[input.gameId,input.version,input.modeId??"",input.levelId??"",input.difficultyId??"",String(input.seed??""),input.challengeKey??"",startedAt].join("|");
  return{
    schemaVersion:1,
    runId:input.runId??`${input.gameId}-${stableHashString(identity).toString(36)}`,
    gameId:input.gameId,
    version:input.version,
    modeId:input.modeId,
    levelId:input.levelId,
    difficultyId:input.difficultyId,
    seed:input.seed,
    challengeKey:input.challengeKey,
    startedAt,
    metadata:input.metadata?{...input.metadata}:undefined
  };
}

export function runMetadata(run:RunDescriptor):Record<string,string|number|boolean>{
  return Object.fromEntries(Object.entries({runId:run.runId,gameId:run.gameId,version:run.version,modeId:run.modeId,levelId:run.levelId,difficultyId:run.difficultyId,seed:run.seed,challengeKey:run.challengeKey}).filter(([,value])=>value!==undefined)) as Record<string,string|number|boolean>;
}
