import { EventBus } from "../../core/EventBus.js";

export interface TrainingSettings {
  infiniteHealth:boolean; infiniteResources:boolean; slowMotion:number;
  dummyBehavior:string; showHitboxes:boolean; showInputHistory:boolean; showDamage:boolean;
}
export const defaultTrainingSettings:TrainingSettings={
  infiniteHealth:false,infiniteResources:false,slowMotion:1,dummyBehavior:"idle",
  showHitboxes:false,showInputHistory:true,showDamage:true
};
export interface TrainingBookmark<T=unknown>{id:string;label?:string;state:T;createdAt:number;}
export interface TrainingEvents<T=unknown>{
  "training:settings":TrainingSettings;"training:reset":undefined;
  "training:bookmark-saved":TrainingBookmark<T>;"training:bookmark-loaded":TrainingBookmark<T>;
  [key:string]:unknown;
}
export class TrainingManager<TState=unknown>{
  readonly events=new EventBus<TrainingEvents<TState>>();
  private settings:TrainingSettings={...defaultTrainingSettings};
  private bookmarks=new Map<string,TrainingBookmark<TState>>();
  constructor(private readonly capture?:()=>TState,private readonly restore?:(state:TState)=>void){}
  configure(patch:Partial<TrainingSettings>):TrainingSettings{this.settings={...this.settings,...patch};const s=this.snapshot();this.events.emit("training:settings",s);return s;}
  snapshot():TrainingSettings{return {...this.settings};}
  reset():void{this.events.emit("training:reset",undefined);}
  saveBookmark(id:string,label?:string):TrainingBookmark<TState>{
    if(!this.capture)throw new Error("TrainingManager requires a capture() hook for bookmarks");
    const b={id,label,state:structuredClone(this.capture()),createdAt:Date.now()};this.bookmarks.set(id,b);this.events.emit("training:bookmark-saved",structuredClone(b));return structuredClone(b);
  }
  loadBookmark(id:string):TrainingBookmark<TState>{
    const b=this.bookmarks.get(id);if(!b)throw new Error(`Unknown training bookmark: ${id}`);this.restore?.(structuredClone(b.state));this.events.emit("training:bookmark-loaded",structuredClone(b));return structuredClone(b);
  }
}
