import { EventBus } from "../core/EventBus.js";
export type Reward =
  | {type:"currency";id:string;amount:number}
  | {type:"unlock";id:string}
  | {type:"item";id:string;amount?:number}
  | {type:"cosmetic";id:string}
  | {type:"custom";id:string;payload?:unknown};
export type RewardHandler=(reward:Reward)=>void|Promise<void>;
export interface RewardEvents {
  "reward:granting": Reward;
  "reward:granted": Reward;
  "rewards:granted": { rewards:Reward[] };
  [key:string]:unknown;
}
export class RewardManager {
  readonly events=new EventBus<RewardEvents>();
  private handlers=new Map<Reward["type"],RewardHandler>();
  register(type:Reward["type"],handler:RewardHandler):this{this.handlers.set(type,handler);return this;}
  async grant(rewards:readonly Reward[]):Promise<void>{
    const granted:Reward[]=[];
    for(const reward of rewards){
      const copy=structuredClone(reward); this.events.emit("reward:granting",copy);
      const handler=this.handlers.get(reward.type); if(handler)await handler(reward);
      granted.push(copy); this.events.emit("reward:granted",copy);
    }
    this.events.emit("rewards:granted",{rewards:granted});
  }
}
