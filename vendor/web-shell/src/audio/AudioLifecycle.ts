import type { AudioSystem } from "./AudioContract.js";

export interface AudioLifecycleOptions {
  pauseOnHidden?:boolean;
  pauseOnGamePause?:boolean;
}

/** Coordinates browser visibility and shell pause state with a game's audio
 * implementation. Prevents loops/music continuing behind pause menus or after
 * tab blur without forcing a specific WebAudio implementation. */
export class AudioLifecycleCoordinator {
  private readonly pauseOnHidden:boolean;
  private readonly pauseOnGamePause:boolean;
  private hidden=false;
  private gamePaused=false;
  private suspended=false;
  private detachVisibility:(()=>void)|null=null;

  constructor(private readonly audio:AudioSystem,options:AudioLifecycleOptions={}){
    this.pauseOnHidden=options.pauseOnHidden!==false;
    this.pauseOnGamePause=options.pauseOnGamePause!==false;
  }

  installVisibility(documentRef:Document|undefined=typeof document!=="undefined"?document:undefined):()=>void{
    this.detachVisibility?.();
    if(!documentRef)return()=>{};
    const onChange=()=>{this.hidden=documentRef.hidden;this.sync();};
    documentRef.addEventListener("visibilitychange",onChange);onChange();
    const detach=()=>documentRef.removeEventListener("visibilitychange",onChange);
    this.detachVisibility=detach;return detach;
  }

  setGamePaused(paused:boolean):void{this.gamePaused=paused;this.sync();}
  dispose():void{this.detachVisibility?.();this.detachVisibility=null;this.hidden=false;this.gamePaused=false;if(this.suspended){this.audio.resumeAll?.();this.suspended=false;}}

  private sync():void{
    const shouldSuspend=(this.pauseOnHidden&&this.hidden)||(this.pauseOnGamePause&&this.gamePaused);
    if(shouldSuspend===this.suspended)return;
    this.suspended=shouldSuspend;
    if(shouldSuspend)this.audio.pauseAll?.();else this.audio.resumeAll?.();
  }
}
