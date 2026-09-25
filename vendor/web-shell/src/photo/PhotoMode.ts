import { EventBus } from "../core/EventBus.js";

export interface PhotoModeState {
  active:boolean;
  hideHud:boolean;
  timeScale:number;
  exposure:number;
  fov?:number;
  roll?:number;
  filterId?:string;
}
export interface PhotoModeEvents {
  "photo:enter":PhotoModeState;
  "photo:change":PhotoModeState;
  "photo:exit":PhotoModeState;
  "photo:capture":PhotoModeState;
  [key:string]:unknown;
}

export class PhotoModeController {
  readonly events=new EventBus<PhotoModeEvents>();
  private state:PhotoModeState={active:false,hideHud:true,timeScale:0,exposure:1};
  enter(overrides:Partial<Omit<PhotoModeState,"active">>={}):PhotoModeState{
    this.state={...this.state,...overrides,active:true};this.events.emit("photo:enter",this.snapshot());return this.snapshot();
  }
  patch(changes:Partial<Omit<PhotoModeState,"active">>):PhotoModeState{
    if(!this.state.active)throw new Error("Photo mode is not active");
    this.state={...this.state,...changes};this.events.emit("photo:change",this.snapshot());return this.snapshot();
  }
  capture():void{if(!this.state.active)throw new Error("Photo mode is not active");this.events.emit("photo:capture",this.snapshot());}
  exit():PhotoModeState{
    const previous=this.snapshot();this.state={...this.state,active:false};this.events.emit("photo:exit",previous);return this.snapshot();
  }
  snapshot():PhotoModeState{return{...this.state};}
}
