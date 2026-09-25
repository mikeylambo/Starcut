import type { BuildInfo, JsonValue } from "../core/types.js";

export interface DiagnosticEntry{at:string;kind:"error"|"warning"|"info";message:string;stack?:string;context?:Record<string,JsonValue>;}
export interface DiagnosticReport{schemaVersion:1;build?:BuildInfo;generatedAt:string;userAgent?:string;url?:string;entries:DiagnosticEntry[];}

export class RuntimeDiagnostics{
  private readonly entries:DiagnosticEntry[]=[];
  private uninstallers:(()=>void)[]=[];
  constructor(private readonly build?:BuildInfo,private readonly maxEntries=200){}
  capture(error:unknown,context?:Record<string,JsonValue>):DiagnosticEntry{
    const normalized=error instanceof Error?error:new Error(String(error));
    return this.push("error",normalized.message,normalized.stack,context);
  }
  warn(message:string,context?:Record<string,JsonValue>):DiagnosticEntry{return this.push("warning",message,undefined,context);}
  info(message:string,context?:Record<string,JsonValue>):DiagnosticEntry{return this.push("info",message,undefined,context);}
  private push(kind:DiagnosticEntry["kind"],message:string,stack?:string,context?:Record<string,JsonValue>):DiagnosticEntry{
    const entry:DiagnosticEntry={at:new Date().toISOString(),kind,message,stack,context};
    this.entries.push(entry);if(this.entries.length>this.maxEntries)this.entries.splice(0,this.entries.length-this.maxEntries);return entry;
  }
  installGlobalHandlers():()=>void{
    if(typeof window==="undefined")return()=>{};
    const onError=(event:ErrorEvent)=>this.capture(event.error??event.message,{source:event.filename,line:event.lineno,column:event.colno});
    const onRejection=(event:PromiseRejectionEvent)=>this.capture(event.reason,{source:"unhandledrejection"});
    window.addEventListener("error",onError);window.addEventListener("unhandledrejection",onRejection);
    const uninstall=()=>{window.removeEventListener("error",onError);window.removeEventListener("unhandledrejection",onRejection);};
    this.uninstallers.push(uninstall);return uninstall;
  }
  dispose():void{for(const off of this.uninstallers.splice(0))off();}
  snapshot():readonly DiagnosticEntry[]{return this.entries.map(e=>({...e,context:e.context?{...e.context}:undefined}));}
  clear():void{this.entries.length=0;}
  report():DiagnosticReport{return{schemaVersion:1,build:this.build,generatedAt:new Date().toISOString(),userAgent:typeof navigator!=="undefined"?navigator.userAgent:undefined,url:typeof location!=="undefined"?location.href:undefined,entries:[...this.entries]};}
  exportJSON(pretty=true):string{return JSON.stringify(this.report(),null,pretty?2:0);}
}
