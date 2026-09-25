import { EventBus } from "../core/EventBus.js";

export interface OnboardingLesson{
  id:string;
  title?:string;
  text:string;
  action?:string;
  tags?:string[];
  payload?:unknown;
  repeatable?:boolean;
}
export interface OnboardingFlow{ id:string; lessons:string[]; skippable?:boolean; }
export interface OnboardingState{completedLessons:string[];completedFlows:string[];skippedFlows:string[];}
export interface OnboardingEvents{
  "onboarding:flow-start":{flowId:string};
  "onboarding:lesson":{flowId:string|null;lesson:OnboardingLesson;index:number};
  "onboarding:lesson-complete":{lessonId:string};
  "onboarding:flow-complete":{flowId:string};
  "onboarding:flow-skip":{flowId:string};
  "onboarding:dismiss":{lessonId:string};
  [key:string]:unknown;
}

/** Renderer-neutral first-run/contextual teaching state generalized from shipped game onboarding. */
export class OnboardingManager{
  readonly events=new EventBus<OnboardingEvents>();
  private readonly lessons=new Map<string,OnboardingLesson>();
  private readonly flows=new Map<string,OnboardingFlow>();
  private completedLessons=new Set<string>();private completedFlows=new Set<string>();private skippedFlows=new Set<string>();
  private activeFlow:OnboardingFlow|null=null;private index=-1;private activeLesson:OnboardingLesson|null=null;

  registerLessons(lessons:readonly OnboardingLesson[]):void{for(const lesson of lessons){if(!lesson.id)throw new Error("Onboarding lesson requires id");this.lessons.set(lesson.id,structuredClone(lesson));}}
  registerFlows(flows:readonly OnboardingFlow[]):void{for(const flow of flows){if(!flow.id||flow.lessons.length===0)throw new Error("Onboarding flow requires id and lessons");this.flows.set(flow.id,structuredClone(flow));}}

  start(flowId:string,options:{force?:boolean}={}):OnboardingLesson|null{
    const flow=this.flows.get(flowId);if(!flow)throw new Error(`Unknown onboarding flow: ${flowId}`);
    if(!options.force&&(this.completedFlows.has(flowId)||this.skippedFlows.has(flowId)))return null;
    this.activeFlow=structuredClone(flow);this.index=-1;this.activeLesson=null;
    this.events.emit("onboarding:flow-start",{flowId});return this.advance();
  }

  /** Show a contextual/help lesson without entering a flow. */
  show(lessonId:string,options:{force?:boolean}={}):OnboardingLesson|null{
    const lesson=this.lessons.get(lessonId);if(!lesson)throw new Error(`Unknown onboarding lesson: ${lessonId}`);
    if(!options.force&&!lesson.repeatable&&this.completedLessons.has(lessonId))return null;
    this.activeFlow=null;this.index=0;this.activeLesson=structuredClone(lesson);this.emitLesson();return structuredClone(this.activeLesson);
  }

  completeCurrent():OnboardingLesson|null{
    if(!this.activeLesson)return null;
    const id=this.activeLesson.id;this.completedLessons.add(id);this.events.emit("onboarding:lesson-complete",{lessonId:id});
    if(!this.activeFlow){this.activeLesson=null;this.events.emit("onboarding:dismiss",{lessonId:id});return null;}
    return this.advance();
  }

  dismiss():void{if(!this.activeLesson)return;const id=this.activeLesson.id;this.activeLesson=null;this.activeFlow=null;this.index=-1;this.events.emit("onboarding:dismiss",{lessonId:id});}

  skipFlow():boolean{
    if(!this.activeFlow||this.activeFlow.skippable===false)return false;
    const flowId=this.activeFlow.id;this.skippedFlows.add(flowId);this.activeFlow=null;this.activeLesson=null;this.index=-1;this.events.emit("onboarding:flow-skip",{flowId});return true;
  }

  hasCompletedLesson(id:string):boolean{return this.completedLessons.has(id);}
  hasCompletedFlow(id:string):boolean{return this.completedFlows.has(id);}
  snapshot():OnboardingState{return{completedLessons:[...this.completedLessons],completedFlows:[...this.completedFlows],skippedFlows:[...this.skippedFlows]};}
  hydrate(state:Partial<OnboardingState>):void{this.completedLessons=new Set(state.completedLessons??[]);this.completedFlows=new Set(state.completedFlows??[]);this.skippedFlows=new Set(state.skippedFlows??[]);}
  get current():OnboardingLesson|null{return this.activeLesson?structuredClone(this.activeLesson):null;}
  get flowId():string|null{return this.activeFlow?.id??null;}

  private advance():OnboardingLesson|null{
    if(!this.activeFlow)return null;
    while(++this.index<this.activeFlow.lessons.length){const id=this.activeFlow.lessons[this.index]!;const lesson=this.lessons.get(id);if(!lesson)throw new Error(`Unknown onboarding lesson in ${this.activeFlow.id}: ${id}`);if(!lesson.repeatable&&this.completedLessons.has(id))continue;this.activeLesson=structuredClone(lesson);this.emitLesson();return structuredClone(this.activeLesson);}
    const flowId=this.activeFlow.id;this.completedFlows.add(flowId);this.activeFlow=null;this.activeLesson=null;this.index=-1;this.events.emit("onboarding:flow-complete",{flowId});return null;
  }
  private emitLesson():void{if(!this.activeLesson)return;this.events.emit("onboarding:lesson",{flowId:this.activeFlow?.id??null,lesson:structuredClone(this.activeLesson),index:this.index});}
}
