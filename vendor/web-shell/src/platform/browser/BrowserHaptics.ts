export interface HapticPattern{mobile:number|number[];duration:number;weak:number;strong:number;}
export type HapticCatalog=Record<string,HapticPattern>;

/** Browser-safe haptics bridge generalized from Descent's mobile + gamepad rumble layer. */
export class BrowserHaptics{
  private enabled=true;
  constructor(private readonly catalog:HapticCatalog={}){}
  setEnabled(enabled:boolean):boolean{this.enabled=enabled;if(!enabled&&typeof navigator!=="undefined"&&typeof navigator.vibrate==="function")try{navigator.vibrate(0);}catch{}return this.enabled;}
  pulse(id:string):boolean{
    const spec=this.catalog[id];if(!spec||!this.enabled)return false;
    if(typeof document!=="undefined"&&document.hidden)return false;
    let fired=false;
    if(typeof navigator!=="undefined"&&typeof navigator.vibrate==="function")try{navigator.vibrate(spec.mobile);fired=true;}catch{}
    if(typeof navigator!=="undefined"&&typeof navigator.getGamepads==="function"){
      try{for(const pad of [...(navigator.getGamepads()||[])].filter(Boolean)){
        const anyPad=pad as Gamepad & {vibrationActuator?:{playEffect?:(type:string,params:unknown)=>Promise<unknown>};hapticActuators?:Array<{pulse?:(value:number,duration:number)=>Promise<unknown>}>};
        const actuator=anyPad.vibrationActuator;
        if(actuator?.playEffect){void actuator.playEffect("dual-rumble",{startDelay:0,duration:spec.duration,weakMagnitude:spec.weak,strongMagnitude:spec.strong}).catch(()=>{});fired=true;continue;}
        const haptic=anyPad.hapticActuators?.[0];if(haptic?.pulse){void haptic.pulse(Math.max(spec.weak,spec.strong),spec.duration).catch(()=>{});fired=true;}
      }}catch{}
    }
    return fired;
  }
  get isEnabled():boolean{return this.enabled;}
}
