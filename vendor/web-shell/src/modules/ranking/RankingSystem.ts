export interface RankBand { id:string; label:string; minimum:number; }
export interface RankResult { rank:RankBand; score:number; breakdown:Record<string,number>; }
export class RankingSystem{
  constructor(private readonly bands:readonly RankBand[]){}
  evaluate(score:number,breakdown:Record<string,number>={}):RankResult{
    const sorted=[...this.bands].sort((a,b)=>a.minimum-b.minimum);
    if(!sorted.length)throw new Error("RankingSystem requires at least one rank band");
    let rank=sorted[0]!;
    for(const band of sorted)if(score>=band.minimum)rank=band;
    return {rank:structuredClone(rank),score,breakdown:{...breakdown}};
  }
  static letterGrades():RankingSystem{return new RankingSystem([
    {id:"d",label:"D",minimum:0},{id:"c",label:"C",minimum:50},{id:"b",label:"B",minimum:65},
    {id:"a",label:"A",minimum:80},{id:"s",label:"S",minimum:90},{id:"ss",label:"SS",minimum:97}
  ]);}
}
