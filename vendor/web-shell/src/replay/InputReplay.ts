export interface InputReplayFrame<T>{atMs:number;action:T;}
export interface InputReplayData<T>{schemaVersion:1;startedAt:number;durationMs:number;frames:InputReplayFrame<T>[];metadata?:Record<string,string|number|boolean>;}

export class InputReplayRecorder<T>{
  private readonly frames:InputReplayFrame<T>[]=[];
  private readonly startedAt:number;
  constructor(private readonly clock:()=>number=()=>performance.now(),private readonly metadata?:Record<string,string|number|boolean>){this.startedAt=this.clock();}
  record(action:T):void{this.frames.push({atMs:Math.max(0,this.clock()-this.startedAt),action});}
  finish():InputReplayData<T>{const durationMs=Math.max(this.frames.at(-1)?.atMs??0,this.clock()-this.startedAt);return{schemaVersion:1,startedAt:this.startedAt,durationMs,frames:this.frames.map(f=>({...f})),metadata:this.metadata?{...this.metadata}:undefined};}
}

export class InputReplayPlayer<T>{
  private index=0;
  private elapsedMs=0;
  constructor(readonly replay:InputReplayData<T>){}
  reset():void{this.index=0;this.elapsedMs=0;}
  seek(ms:number):void{this.elapsedMs=Math.max(0,ms);this.index=this.replay.frames.findIndex(f=>f.atMs>=this.elapsedMs);if(this.index<0)this.index=this.replay.frames.length;}
  advance(deltaMs:number):T[]{
    this.elapsedMs=Math.max(0,this.elapsedMs+deltaMs);
    const due:T[]=[];
    while(this.index<this.replay.frames.length&&this.replay.frames[this.index]!.atMs<=this.elapsedMs){due.push(this.replay.frames[this.index]!.action);this.index++;}
    return due;
  }
  get done():boolean{return this.index>=this.replay.frames.length;}
  get timeMs():number{return this.elapsedMs;}
}
