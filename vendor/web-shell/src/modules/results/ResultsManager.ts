import type { RankResult, RankingSystem } from "../ranking/RankingSystem.js";
export interface RunResult {score?:number;timeMs?:number;rank?:RankResult;stats:Record<string,number>;metadata?:Record<string,unknown>;}
export class ResultsManager{
  constructor(private readonly ranking?:RankingSystem){}
  build(stats:Record<string,number>,options:{score?:number;timeMs?:number;metadata?:Record<string,unknown>}={}):RunResult{
    return {score:options.score,timeMs:options.timeMs,rank:options.score!==undefined&&this.ranking?this.ranking.evaluate(options.score,stats):undefined,stats:{...stats},metadata:options.metadata?{...options.metadata}:undefined};
  }
}
