import type { InputDeviceFamily } from "../../input/InputGlyphs.js";

export interface InputFamilyDetectorOptions{onChange?:(family:InputDeviceFamily)=>void;}

export function gamepadFamily(id:string):InputDeviceFamily{
  const value=id.toLowerCase();
  if(/dualsense|dualshock|playstation|sony/.test(value))return"playstation";
  if(/nintendo|joy-con|switch/.test(value))return"nintendo";
  if(/xbox|xinput|microsoft/.test(value))return"xbox";
  return"generic-gamepad";
}

/** Tracks the player's most recently used input family for prompt/glyph switching. */
export class BrowserInputFamilyDetector{
  private family:InputDeviceFamily="keyboard-mouse";
  private detachFns:(()=>void)[]=[];
  constructor(private readonly options:InputFamilyDetectorOptions={}){}
  attach(windowRef:Window=window,documentRef:Document=document):()=>void{
    this.detach();
    const set=(family:InputDeviceFamily)=>this.set(family);
    const onKey=()=>set("keyboard-mouse");
    const onMouse=(event:PointerEvent)=>{if(event.pointerType==="mouse")set("keyboard-mouse");else if(event.pointerType==="touch")set("touch");};
    const onTouch=()=>set("touch");
    const onPad=(event:GamepadEvent)=>set(gamepadFamily(event.gamepad.id));
    windowRef.addEventListener("keydown",onKey,{passive:true});
    windowRef.addEventListener("pointerdown",onMouse,{passive:true});
    windowRef.addEventListener("touchstart",onTouch,{passive:true});
    windowRef.addEventListener("gamepadconnected",onPad);
    this.detachFns=[
      ()=>windowRef.removeEventListener("keydown",onKey),
      ()=>windowRef.removeEventListener("pointerdown",onMouse),
      ()=>windowRef.removeEventListener("touchstart",onTouch),
      ()=>windowRef.removeEventListener("gamepadconnected",onPad)
    ];
    if(documentRef.documentElement.matches?.(":hover")===false&&navigator.maxTouchPoints>0)this.set("touch");
    return()=>this.detach();
  }
  sampleGamepads(navigatorRef:Navigator=navigator):InputDeviceFamily{
    try{for(const pad of navigatorRef.getGamepads?.()??[]){if(!pad)continue;const active=pad.buttons.some(button=>button.pressed||button.value>0.15)||pad.axes.some(axis=>Math.abs(axis)>0.2);if(active){this.set(gamepadFamily(pad.id));break;}}}catch{}
    return this.family;
  }
  set(family:InputDeviceFamily):void{if(family===this.family)return;this.family=family;this.options.onChange?.(family);}
  get activeFamily():InputDeviceFamily{return this.family;}
  detach():void{for(const fn of this.detachFns)fn();this.detachFns=[];}
}
