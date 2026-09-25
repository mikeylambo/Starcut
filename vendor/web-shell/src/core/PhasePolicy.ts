import type { GamePhase } from "./types.js";

export type PhaseTransitionMap=Partial<Record<GamePhase,readonly GamePhase[]>>;

export class PhasePolicy{
  constructor(private readonly allowed:PhaseTransitionMap){}
  allows(from:GamePhase,to:GamePhase):boolean{return from===to||(this.allowed[from]?.includes(to)??false);}
  assert(from:GamePhase,to:GamePhase):void{if(!this.allows(from,to))throw new Error(`Invalid game phase transition: ${from} -> ${to}`);}
}

export const productionPhasePolicy=new PhasePolicy({
  boot:["title","menu","loading","error"],
  title:["menu","loading","error"],
  menu:["title","loading","playing","error"],
  loading:["playing","menu","error"],
  playing:["paused","results","loading","menu","error"],
  paused:["playing","menu","loading","error"],
  results:["menu","loading","playing","error"],
  error:["title","menu","loading"]
});
