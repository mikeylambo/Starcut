import type { VoiceManifest } from "../presentation/VoiceManifest.js";
import type { SubtitleTrack } from "../presentation/Subtitles.js";

export interface ProductionAuditInput{
  voice?:VoiceManifest;
  subtitleTracks?:readonly SubtitleTrack[];
  requiredVoiceIds?:readonly string[];
  requiredSubtitleVoiceIds?:readonly string[];
  requiredFeatures?:readonly {id:string;enabled:boolean}[];
}
export interface ProductionAuditIssue{scope:string;message:string;severity:"warning"|"error";}
export interface ProductionAuditReport{ok:boolean;issues:ProductionAuditIssue[];}

export function auditProduction(input:ProductionAuditInput):ProductionAuditReport{
  const issues:ProductionAuditIssue[]=[];
  if(input.voice)for(const message of input.voice.validate())issues.push({scope:"voice",message,severity:"error"});
  if(input.requiredVoiceIds&&input.voice)for(const id of input.requiredVoiceIds)if(!input.voice.get(id))issues.push({scope:"voice",message:`Missing required voice line: ${id}`,severity:"error"});
  if(input.requiredSubtitleVoiceIds){
    const found=new Set((input.subtitleTracks??[]).flatMap(track=>track.cues.map(cue=>cue.voiceId).filter((id):id is string=>!!id)));
    for(const id of input.requiredSubtitleVoiceIds)if(!found.has(id))issues.push({scope:"subtitles",message:`Missing subtitle cue for voice line: ${id}`,severity:"error"});
  }
  for(const feature of input.requiredFeatures??[])if(!feature.enabled)issues.push({scope:"feature",message:`Required feature disabled: ${feature.id}`,severity:"error"});
  return{ok:issues.every(issue=>issue.severity!=="error"),issues};
}
