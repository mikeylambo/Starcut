export class InputBuffer{
  private until=0;
  constructor(private readonly windowMs:number,private readonly clock:()=>number=()=>performance.now()){}
  press():void{this.until=this.clock()+Math.max(0,this.windowMs);}
  consume():boolean{if(this.clock()>this.until)return false;this.until=0;return true;}
  clear():void{this.until=0;}
}

export function applyRadialDeadzone(x:number,y:number,deadzone=0.15):{x:number;y:number;magnitude:number}{
  const magnitude=Math.min(1,Math.hypot(x,y));if(magnitude<=deadzone)return{x:0,y:0,magnitude:0};
  const scaled=(magnitude-deadzone)/Math.max(0.0001,1-deadzone);const nx=magnitude>0?x/magnitude:0;const ny=magnitude>0?y/magnitude:0;return{x:nx*scaled,y:ny*scaled,magnitude:scaled};
}

export class AnalogHysteresis{
  private active=false;
  constructor(private readonly enterThreshold=0.6,private readonly exitThreshold=0.4){if(exitThreshold>enterThreshold)throw new Error("exitThreshold must be <= enterThreshold");}
  update(value:number):boolean{const magnitude=Math.abs(value);if(this.active){if(magnitude<=this.exitThreshold)this.active=false;}else if(magnitude>=this.enterThreshold)this.active=true;return this.active;}
  reset():void{this.active=false;}
}
