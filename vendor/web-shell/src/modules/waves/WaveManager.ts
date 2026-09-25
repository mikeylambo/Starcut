import { EventBus } from "../../core/EventBus.js";
export interface SpawnDefinition{type:string;count:number;intervalMs?:number;metadata?:Record<string,unknown>;}
export interface WaveDefinition{id:string;spawns:SpawnDefinition[];delayBeforeMs?:number;rewardId?:string;}
export interface WaveEvents{"wave:started":{index:number;wave:WaveDefinition};"wave:completed":{index:number;wave:WaveDefinition};"waves:completed":undefined;[key:string]:unknown;}
export class WaveManager{
  readonly events=new EventBus<WaveEvents>();private waves:WaveDefinition[]=[];private index=-1;private active=false;
  setWaves(waves:readonly WaveDefinition[]):void{this.waves=waves.map(w=>structuredClone(w));this.index=-1;this.active=false;}
  startNext():WaveDefinition|null{if(this.index+1>=this.waves.length){this.events.emit("waves:completed",undefined);return null;}this.index++;this.active=true;const wave=structuredClone(this.waves[this.index]!);this.events.emit("wave:started",{index:this.index,wave});return wave;}
  completeCurrent():void{if(!this.active||this.index<0)return;const wave=structuredClone(this.waves[this.index]!);this.active=false;this.events.emit("wave:completed",{index:this.index,wave});}
  current():WaveDefinition|null{return this.index>=0?structuredClone(this.waves[this.index]??null):null;}
}
