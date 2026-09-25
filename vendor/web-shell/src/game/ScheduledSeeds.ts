import { stableHashString } from "../core/DeterministicRNG.js";

export type SeedCadence="daily"|"weekly";
export interface ScheduledSeed{cadence:SeedCadence;key:string;seed:number;startsAt:string;endsAt:string;}

function startOfUtcDay(date:Date):Date{return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));}
function startOfUtcWeek(date:Date):Date{const day=startOfUtcDay(date);const weekday=(day.getUTCDay()+6)%7;day.setUTCDate(day.getUTCDate()-weekday);return day;}

export function scheduledSeed(gameId:string,cadence:SeedCadence,date:Date=new Date()):ScheduledSeed{
  const start=cadence==="daily"?startOfUtcDay(date):startOfUtcWeek(date);
  const end=new Date(start);end.setUTCDate(end.getUTCDate()+(cadence==="daily"?1:7));
  const key=`${cadence}:${start.toISOString().slice(0,10)}`;
  return{cadence,key,seed:stableHashString(`${gameId}:${key}`),startsAt:start.toISOString(),endsAt:end.toISOString()};
}
