import { EventBus } from "../core/EventBus.js";
import type { ObjectiveDefinition } from "./Objectives.js";
import type { Reward } from "./Rewards.js";

export interface MedalThreshold { medal:string; threshold:number; direction?:"min"|"max"; }
export interface ChallengeDefinition {
  id:string; label:string; description?:string; category?:string;
  objectives:ObjectiveDefinition[]; constraints?:string[];
  modifiers?:Record<string,unknown>; rewards?:Reward[]; medals?:MedalThreshold[];
  leaderboardKey?:string; prerequisiteUnlocks?:string[];
}
export interface ChallengeEvents {
  "challenge:registered": { ids:string[] };
  "challenge:started": ChallengeDefinition;
  "challenge:completed": { challenge:ChallengeDefinition; score?:number; medal?:string|null };
  [key:string]:unknown;
}
export class ChallengeManager {
  readonly events=new EventBus<ChallengeEvents>();
  private challenges=new Map<string,ChallengeDefinition>();
  private activeId:string|null=null;
  register(challenges:readonly ChallengeDefinition[]):void {
    for(const c of challenges)this.challenges.set(c.id,structuredClone(c));
    this.events.emit("challenge:registered",{ids:challenges.map(c=>c.id)});
  }
  get(id:string):ChallengeDefinition|undefined { const v=this.challenges.get(id); return v?structuredClone(v):undefined; }
  list(category?:string):ChallengeDefinition[] { return [...this.challenges.values()].filter(x=>!category||x.category===category).map(x=>structuredClone(x)); }
  start(id:string):ChallengeDefinition { const c=this.require(id); this.activeId=id; const copy=structuredClone(c); this.events.emit("challenge:started",copy); return copy; }
  complete(score?:number):{challenge:ChallengeDefinition; medal:string|null}|null {
    if(!this.activeId)return null; const c=this.require(this.activeId); const medal=score===undefined?null:this.medalFor(c.id,score);
    const payload={challenge:structuredClone(c),score,medal}; this.events.emit("challenge:completed",payload); this.activeId=null; return {challenge:payload.challenge,medal};
  }
  medalFor(id:string,score:number):string|null {
    const c=this.challenges.get(id); if(!c?.medals?.length)return null;
    let earned:string|null=null;
    for(const m of c.medals){const dir=m.direction??"min"; if(dir==="min"?score>=m.threshold:score<=m.threshold)earned=m.medal;}
    return earned;
  }
  private require(id:string):ChallengeDefinition { const c=this.challenges.get(id); if(!c)throw new Error(`Unknown challenge: ${id}`); return c; }
}
