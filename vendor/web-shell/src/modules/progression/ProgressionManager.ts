import { EventBus } from "../../core/EventBus.js";
export interface ProgressionEvents{"xp:changed":{xp:number;level:number};"level:up":{level:number};[key:string]:unknown;}
export class ProgressionManager{
  readonly events=new EventBus<ProgressionEvents>();private xp=0;private level=1;
  constructor(private readonly xpForLevel:(level:number)=>number=(level)=>level*100){}
  addXp(amount:number):number{this.xp+=Math.max(0,amount);while(this.xp>=this.xpForLevel(this.level)){this.level++;this.events.emit("level:up",{level:this.level});}this.events.emit("xp:changed",{xp:this.xp,level:this.level});return this.level;}
  snapshot(){return {xp:this.xp,level:this.level,nextLevelXp:this.xpForLevel(this.level)};}
}
