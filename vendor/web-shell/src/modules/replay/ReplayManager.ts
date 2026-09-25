import type { StorageAdapter } from "../../persistence/StorageAdapter.js";

export interface ReplayFrame<TInput=unknown,TState=unknown>{t:number;input:TInput;state?:TState;}
export interface ReplayTape<TInput=unknown,TState=unknown>{
  id:string;gameVersion:string;levelId?:string;seed?:string|number;
  durationMs:number;sampleHz:number;createdAt:string;frames:ReplayFrame<TInput,TState>[];
  metadata?:Record<string,unknown>;
}
export class ReplayRecorder<TInput=unknown,TState=unknown>{
  private frames:ReplayFrame<TInput,TState>[]=[];private startedAt=0;
  constructor(private readonly sampleHz=60){}
  start(now=performance.now()):void{this.frames=[];this.startedAt=now;}
  record(input:TInput,state?:TState,now=performance.now()):void{this.frames.push({t:now-this.startedAt,input:structuredClone(input),state:state===undefined?undefined:structuredClone(state)});}
  finish(id:string,gameVersion:string,meta:Partial<Omit<ReplayTape<TInput,TState>,"id"|"gameVersion"|"durationMs"|"sampleHz"|"createdAt"|"frames">>={},now=performance.now()):ReplayTape<TInput,TState>{
    return {id,gameVersion,durationMs:Math.max(0,now-this.startedAt),sampleHz:this.sampleHz,createdAt:new Date().toISOString(),frames:this.frames.map(f=>structuredClone(f)),...meta};
  }
}
export class ReplayStore<TInput=unknown,TState=unknown>{
  constructor(private readonly storage:StorageAdapter,private readonly prefix="replay"){}
  save(tape:ReplayTape<TInput,TState>):Promise<void>{return this.storage.set(`${this.prefix}:${tape.id}`,tape);}
  load(id:string):Promise<ReplayTape<TInput,TState>|null>{return this.storage.get(`${this.prefix}:${id}`);}
  remove(id:string):Promise<void>{return this.storage.remove(`${this.prefix}:${id}`);}
}
export class GhostPlayback<TState=unknown>{
  private index=0;
  constructor(private readonly tape:ReplayTape<unknown,TState>){}
  reset():void{this.index=0;}
  sample(timeMs:number):ReplayFrame<unknown,TState>|null{
    while(this.index+1<this.tape.frames.length && this.tape.frames[this.index+1]!.t<=timeMs)this.index++;
    return this.tape.frames[this.index]??null;
  }
}
