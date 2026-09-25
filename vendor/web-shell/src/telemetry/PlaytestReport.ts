import type { JsonValue } from "../core/types.js";
import type { TelemetryEvent } from "./Telemetry.js";

export interface LevelPlaytestStats{
  loads:number;
  completions:number;
  failures:number;
  deaths:number;
  restarts:number;
  completionRate:number;
}
export interface PositionBucket{x:number;y:number;z:number;count:number;}
export interface PlaytestReport{
  schemaVersion:1;
  sessionId:string|null;
  durationMs:number;
  eventCounts:Record<string,number>;
  levels:Record<string,LevelPlaytestStats>;
  deathHotspots:PositionBucket[];
}

const numberValue=(value:JsonValue|undefined):number|undefined=>typeof value==="number"&&Number.isFinite(value)?value:undefined;
const stringValue=(value:JsonValue|undefined):string|undefined=>typeof value==="string"?value:undefined;

/** Builds a deterministic local playtest summary from semantic telemetry. */
export function buildPlaytestReport(events:readonly TelemetryEvent[],positionBucketSize=2):PlaytestReport{
  const sorted=[...events].sort((a,b)=>a.atMs-b.atMs||a.seq-b.seq);
  const eventCounts:Record<string,number>={};
  const levels:Record<string,LevelPlaytestStats>={};
  const hotspotCounts=new Map<string,{x:number;y:number;z:number;count:number}>();
  let activeLevel:string|undefined;
  const statsFor=(id:string)=>levels[id]??(levels[id]={loads:0,completions:0,failures:0,deaths:0,restarts:0,completionRate:0});
  for(const event of sorted){
    eventCounts[event.name]=(eventCounts[event.name]??0)+1;
    const levelId=stringValue(event.data.levelId)??activeLevel;
    if(event.name==="level.load"&&stringValue(event.data.levelId)){activeLevel=stringValue(event.data.levelId);statsFor(activeLevel!).loads++;}
    if(levelId){
      const stats=statsFor(levelId);
      if(event.name==="level.complete")stats.completions++;
      if(event.name==="level.fail")stats.failures++;
      if(event.name==="player.death")stats.deaths++;
      if(event.name==="game.restart")stats.restarts++;
    }
    if(event.name==="player.death"){
      const x=numberValue(event.data.x),y=numberValue(event.data.y),z=numberValue(event.data.z);
      if(x!==undefined&&y!==undefined&&z!==undefined){
        const size=Math.max(0.01,positionBucketSize);const bx=Math.round(x/size)*size,by=Math.round(y/size)*size,bz=Math.round(z/size)*size;const key=`${bx}|${by}|${bz}`;const bucket=hotspotCounts.get(key)??{x:bx,y:by,z:bz,count:0};bucket.count++;hotspotCounts.set(key,bucket);
      }
    }
  }
  for(const stats of Object.values(levels))stats.completionRate=stats.loads>0?stats.completions/stats.loads:0;
  const first=sorted[0]?.atMs??0,last=sorted.at(-1)?.atMs??0;
  return{schemaVersion:1,sessionId:sorted[0]?.sessionId??null,durationMs:Math.max(0,last-first),eventCounts,levels,deathHotspots:[...hotspotCounts.values()].sort((a,b)=>b.count-a.count)};
}
