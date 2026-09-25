export type ReleaseChannel="development"|"demo"|"preview"|"release";
export interface ReleaseManifest{
  gameId:string;
  version:string;
  channel:ReleaseChannel;
  buildId?:string;
  commit?:string;
  demo?:boolean;
  supportedInputs?:string[];
  supportedLocales?:string[];
  requiredFeatures?:string[];
  notes?:string[];
}

export function validateReleaseManifest(manifest:ReleaseManifest):string[]{
  const issues:string[]=[];
  if(!manifest.gameId)issues.push("Missing gameId");
  if(!manifest.version)issues.push("Missing version");
  if(manifest.channel==="demo"&&manifest.demo===false)issues.push("Demo channel cannot declare demo=false");
  return issues;
}
