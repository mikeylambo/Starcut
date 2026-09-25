export interface TimelineCue<T=unknown>{atMs:number;id:string;payload?:T;}
export interface TimelineOptions{durationMs?:number;loop?:boolean;}

export class Timeline<T=unknown>{
  private readonly cues:TimelineCue<T>[]=[];
  private timeMs=0;
  private index=0;
  private playing=false;
  constructor(private readonly options:TimelineOptions={}){}
  add(cue:TimelineCue<T>):this{this.cues.push({...cue});this.cues.sort((a,b)=>a.atMs-b.atMs);this.seek(this.timeMs);return this;}
  play():void{this.playing=true;}
  pause():void{this.playing=false;}
  reset():void{this.timeMs=0;this.index=0;this.playing=false;}
  seek(ms:number):void{this.timeMs=Math.max(0,ms);this.index=this.cues.findIndex(c=>c.atMs>=this.timeMs);if(this.index<0)this.index=this.cues.length;}
  tick(deltaMs:number):TimelineCue<T>[] {
    if(!this.playing||deltaMs<=0)return[];
    const due:TimelineCue<T>[]=[];this.timeMs+=deltaMs;
    while(this.index<this.cues.length&&this.cues[this.index]!.atMs<=this.timeMs){due.push({...this.cues[this.index]!});this.index++;}
    const duration=this.options.durationMs??this.cues.at(-1)?.atMs??0;
    if(duration>0&&this.timeMs>=duration){if(this.options.loop){this.timeMs%=duration;this.index=0;while(this.index<this.cues.length&&this.cues[this.index]!.atMs<=this.timeMs){due.push({...this.cues[this.index]!});this.index++;}}else this.playing=false;}
    return due;
  }
  get currentTimeMs():number{return this.timeMs;}
  get isPlaying():boolean{return this.playing;}
}
