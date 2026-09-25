import { EventBus } from "../core/EventBus.js";

export type SubtitleSpeakerMode="name"|"portrait"|"hidden";
export interface SubtitleStyle{maxLines?:number;textScale?:number;backgroundOpacity?:number;speakerMode?:SubtitleSpeakerMode;}
export interface SubtitleCue{ id:string; startMs:number; endMs:number; text:string; speaker?:string; voiceId?:string; priority?:number; tags?:string[]; }
export interface SubtitleTrack{ id:string; cues:SubtitleCue[]; locale?:string; }
export interface SubtitleEvents{
  "subtitle:show":SubtitleCue;
  "subtitle:hide":{id:string};
  [key:string]:unknown;
}

/** Renderer-neutral timed subtitle scheduler. Presentation subscribes to events. */
export class SubtitlePlayer{
  readonly events=new EventBus<SubtitleEvents>();
  private track:SubtitleTrack|null=null;private timeMs=0;private active=new Set<string>();private playing=false;
  constructor(readonly style:SubtitleStyle={}){}
  load(track:SubtitleTrack):void{this.stop();this.track=structuredClone(track);this.timeMs=0;}
  play():void{if(this.track)this.playing=true;}
  pause():void{this.playing=false;}
  stop():void{for(const id of this.active)this.events.emit("subtitle:hide",{id});this.active.clear();this.playing=false;this.timeMs=0;}
  seek(ms:number):void{this.stop();this.timeMs=Math.max(0,ms);this.sync();}
  tick(deltaMs:number):void{if(!this.playing||!this.track||deltaMs<=0)return;this.timeMs+=deltaMs;this.sync();}
  get currentTimeMs():number{return this.timeMs;}
  private sync():void{
    if(!this.track)return;
    const should=new Set(this.track.cues.filter(c=>c.startMs<=this.timeMs&&c.endMs>this.timeMs).sort((a,b)=>(b.priority??0)-(a.priority??0)).map(c=>c.id));
    for(const id of [...this.active])if(!should.has(id)){this.active.delete(id);this.events.emit("subtitle:hide",{id});}
    for(const cue of this.track.cues)if(should.has(cue.id)&&!this.active.has(cue.id)){this.active.add(cue.id);this.events.emit("subtitle:show",structuredClone(cue));}
  }
}
