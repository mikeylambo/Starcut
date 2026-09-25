export interface VoiceLine{ id:string; speaker:string; assetId:string; textKey?:string; durationMs?:number; locale?:string; emotion?:string; tags?:string[]; }

/** Central registry for VO ids so narrative, subtitles, localization and audio stay aligned. */
export class VoiceManifest{
  private readonly lines=new Map<string,VoiceLine>();
  register(lines:readonly VoiceLine[]):void{for(const line of lines){if(!line.id||!line.assetId)throw new Error("Voice line requires id and assetId");this.lines.set(line.id,structuredClone(line));}}
  get(id:string):VoiceLine|null{const line=this.lines.get(id);return line?structuredClone(line):null;}
  list():VoiceLine[]{return[...this.lines.values()].map(line=>structuredClone(line));}
  validate():string[]{const issues:string[]=[];for(const line of this.lines.values()){if(!line.speaker)issues.push(`${line.id}: missing speaker`);if(line.durationMs!==undefined&&line.durationMs<=0)issues.push(`${line.id}: invalid duration`);}return issues;}
}
