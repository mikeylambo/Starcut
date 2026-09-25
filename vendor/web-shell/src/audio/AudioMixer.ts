import type { AudioBusName,AudioSystem } from "./AudioContract.js";

export const STANDARD_AUDIO_BUSES=["master","music","sfx","ui","voice","ambience"] as const;
export type StandardAudioBus=(typeof STANDARD_AUDIO_BUSES)[number];
export interface AudioMixSnapshot{id:string;volumes?:Partial<Record<StandardAudioBus,number>>;muted?:boolean;}

/** Renderer/audio-engine-neutral mix state. Games supply AudioSystem; shell owns consistent bus policy. */
export class AudioMixer{
  private readonly base=new Map<AudioBusName,number>();
  private readonly modifiers=new Map<string,Map<AudioBusName,number>>();
  private muted=false;
  constructor(private readonly audio:AudioSystem){for(const bus of STANDARD_AUDIO_BUSES)this.base.set(bus,1);this.applyAll();}
  setVolume(bus:AudioBusName,value:number):void{this.base.set(bus,this.clamp(value));this.apply(bus);}
  getVolume(bus:AudioBusName):number{return this.base.get(bus)??1;}
  setMuted(muted:boolean):void{this.muted=muted;this.audio.setMuted(muted);}
  get isMuted():boolean{return this.muted;}
  pushModifier(id:string,volumes:Partial<Record<StandardAudioBus,number>>):void{const map=new Map<AudioBusName,number>();for(const [bus,value] of Object.entries(volumes))if(value!==undefined)map.set(bus,this.clamp(value));this.modifiers.set(id,map);this.applyAll();}
  removeModifier(id:string):boolean{const removed=this.modifiers.delete(id);if(removed)this.applyAll();return removed;}
  applySnapshot(snapshot:AudioMixSnapshot):void{if(snapshot.volumes)for(const [bus,value] of Object.entries(snapshot.volumes))if(value!==undefined)this.setVolume(bus,value);if(snapshot.muted!==undefined)this.setMuted(snapshot.muted);}
  duck(id:string,buses:readonly StandardAudioBus[],amount:number):()=>void{this.pushModifier(id,Object.fromEntries(buses.map(bus=>[bus,amount])) as Partial<Record<StandardAudioBus,number>>);return()=>this.removeModifier(id);}
  snapshot():{muted:boolean;volumes:Record<string,number>;effective:Record<string,number>;modifiers:string[]}{const volumes=Object.fromEntries(this.base);return{muted:this.muted,volumes,effective:Object.fromEntries([...this.base.keys()].map(bus=>[bus,this.effective(bus)])),modifiers:[...this.modifiers.keys()]};}
  private effective(bus:AudioBusName):number{let value=this.base.get(bus)??1;for(const modifier of this.modifiers.values())value*=modifier.get(bus)??1;return this.clamp(value);}
  private apply(bus:AudioBusName):void{this.audio.setBusVolume(bus,this.effective(bus));}
  private applyAll():void{for(const bus of this.base.keys())this.apply(bus);}
  private clamp(value:number):number{return Math.min(1,Math.max(0,Number.isFinite(value)?value:0));}
}
