import { EventBus } from "../../core/EventBus.js";
export interface LocalPlayer{slot:number;deviceId:string;profileId?:string;ready:boolean;}
export interface PlayerAssignmentEvents{"player:joined":LocalPlayer;"player:left":LocalPlayer;"player:ready":LocalPlayer;[key:string]:unknown;}
export class PlayerAssignmentManager{
  readonly events=new EventBus<PlayerAssignmentEvents>();private players=new Map<number,LocalPlayer>();
  constructor(private readonly maxPlayers=4){}
  join(deviceId:string,profileId?:string):LocalPlayer{
    const existing=[...this.players.values()].find(p=>p.deviceId===deviceId);if(existing)return structuredClone(existing);
    for(let slot=1;slot<=this.maxPlayers;slot++)if(!this.players.has(slot)){const p={slot,deviceId,profileId,ready:false};this.players.set(slot,p);this.events.emit("player:joined",structuredClone(p));return structuredClone(p);}
    throw new Error("No local player slots available");
  }
  leave(slot:number):boolean{const p=this.players.get(slot);if(!p)return false;this.players.delete(slot);this.events.emit("player:left",structuredClone(p));return true;}
  setReady(slot:number,ready=true):LocalPlayer{const p=this.players.get(slot);if(!p)throw new Error(`Unknown player slot: ${slot}`);p.ready=ready;this.events.emit("player:ready",structuredClone(p));return structuredClone(p);}
  allReady(minPlayers=1):boolean{return this.players.size>=minPlayers&&[...this.players.values()].every(p=>p.ready);}
  list():LocalPlayer[]{return [...this.players.values()].map(p=>structuredClone(p));}
}
