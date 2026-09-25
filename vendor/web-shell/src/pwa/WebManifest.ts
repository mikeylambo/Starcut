export type WebAppDisplay="fullscreen"|"standalone"|"minimal-ui"|"browser";
export interface WebManifestIcon{src:string;sizes:string;type?:string;purpose?:"any"|"maskable"|"monochrome"|string;}
export interface WebGameManifest{
  id?:string;name:string;short_name:string;description?:string;start_url?:string;scope?:string;
  display?:WebAppDisplay;orientation?:"any"|"natural"|"landscape"|"portrait"|"landscape-primary"|"portrait-primary";
  background_color?:string;theme_color?:string;categories?:string[];icons?:WebManifestIcon[];
}
export function validateWebManifest(manifest:WebGameManifest):string[]{
  const issues:string[]=[];
  if(!manifest.name)issues.push("Missing name");if(!manifest.short_name)issues.push("Missing short_name");
  if(!manifest.icons?.some(icon=>icon.sizes.split(/\s+/).includes("192x192")))issues.push("Missing 192x192 icon");
  if(!manifest.icons?.some(icon=>icon.sizes.split(/\s+/).includes("512x512")))issues.push("Missing 512x512 icon");
  return issues;
}
