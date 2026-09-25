export type GyroLookMode="off"|"always"|"conditional";
export interface GyroLookOptions{sensitivity?:number;mode?:GyroLookMode;condition?:()=>boolean;}

/** Orientation-aware device-motion look source generalized from Traversal FPS. */
export class GyroLook{
  private x=0;private y=0;private enabled=false;private permission=false;private mode:GyroLookMode;private sensitivity:number;
  constructor(private readonly options:GyroLookOptions={}){this.mode=options.mode??"off";this.sensitivity=options.sensitivity??0.7;}
  async requestPermission():Promise<boolean>{
    if(typeof DeviceMotionEvent==="undefined")return false;
    const ctor=DeviceMotionEvent as typeof DeviceMotionEvent & {requestPermission?:()=>Promise<"granted"|"denied">};
    try{this.permission=ctor.requestPermission?(await ctor.requestPermission())==="granted":true;}catch{this.permission=false;}
    return this.permission;
  }
  attach(target:Window=window):()=>void{const handler=(event:DeviceMotionEvent)=>this.onMotion(event);target.addEventListener("devicemotion",handler);this.enabled=true;return()=>{target.removeEventListener("devicemotion",handler);this.enabled=false;};}
  setMode(mode:GyroLookMode):void{this.mode=mode;}
  setSensitivity(value:number):void{this.sensitivity=Math.max(0,value);}
  consume():{x:number;y:number}{const value={x:this.x,y:this.y};this.x=0;this.y=0;return value;}
  get granted():boolean{return this.permission;}
  private onMotion(event:DeviceMotionEvent):void{
    if(!this.enabled||!this.permission||this.mode==="off")return;if(this.mode==="conditional"&&!this.options.condition?.())return;
    const rotation=event.rotationRate;if(!rotation)return;const angle=Number(screen.orientation?.angle??0);
    let yaw=rotation.gamma??0,pitch=rotation.beta??0;
    if(angle===90){yaw=rotation.beta??0;pitch=-(rotation.gamma??0);}else if(angle===270){yaw=-(rotation.beta??0);pitch=rotation.gamma??0;}else if(angle===180){yaw=-(rotation.gamma??0);pitch=-(rotation.beta??0);}
    this.x+=yaw*this.sensitivity;this.y+=pitch*this.sensitivity;
  }
}
