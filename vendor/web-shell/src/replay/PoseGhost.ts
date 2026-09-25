export interface GhostPose {
  x:number;
  y:number;
  z:number;
  state?:number;
}

export interface GhostRecordingMetadata {
  id?:string;
  seed?:string|number;
  levelId?:string;
  durationMs?:number;
  [key:string]:string|number|boolean|undefined;
}

export interface GhostRecording {
  schemaVersion:1;
  sampleHz:number;
  stride:5;
  samples:number[];
  metadata?:GhostRecordingMetadata;
}

export interface GhostRecorderOptions {
  sampleHz?:number;
  maxSamples?:number;
  positionScale?:number;
  clock?:()=>number;
}

const DEFAULT_SAMPLE_HZ=15;
const DEFAULT_MAX_SAMPLES=60*15*10;
const DEFAULT_POSITION_SCALE=100;
const STRIDE=5 as const;

/**
 * Lightweight pose recording inspired by Descent's ghost implementation.
 * Playback interpolates captured poses instead of re-running simulation, so
 * ghosts remain renderer-neutral, deterministic and cheap to store.
 */
export class PoseGhostRecorder {
  private readonly sampleHz:number;
  private readonly maxSamples:number;
  private readonly positionScale:number;
  private readonly clock:()=>number;
  private readonly startedAt:number;
  private nextSampleMs=0;
  private finished=false;
  private readonly samples:number[]=[];

  constructor(options:GhostRecorderOptions={}){
    this.sampleHz=Math.max(1,options.sampleHz??DEFAULT_SAMPLE_HZ);
    this.maxSamples=Math.max(1,options.maxSamples??DEFAULT_MAX_SAMPLES);
    this.positionScale=Math.max(1,options.positionScale??DEFAULT_POSITION_SCALE);
    this.clock=options.clock??(()=>performance.now());
    this.startedAt=this.clock();
  }

  sample(pose:GhostPose,force=false):boolean{
    if(this.finished)return false;
    const elapsed=Math.max(0,this.clock()-this.startedAt);
    if(!force&&elapsed<this.nextSampleMs)return false;
    if(this.samples.length/STRIDE>=this.maxSamples){this.finished=true;return false;}
    this.samples.push(
      Math.round(elapsed),
      Math.round(pose.x*this.positionScale),
      Math.round(pose.y*this.positionScale),
      Math.round(pose.z*this.positionScale),
      pose.state??0
    );
    this.nextSampleMs=elapsed+1000/this.sampleHz;
    return true;
  }

  finish(pose?:GhostPose):void{
    if(this.finished)return;
    if(pose)this.sample(pose,true);
    this.finished=true;
  }

  serialize(metadata?:GhostRecordingMetadata):GhostRecording{
    const lastTime=this.samples.length>=STRIDE?this.samples[this.samples.length-STRIDE]:0;
    return{
      schemaVersion:1,
      sampleHz:this.sampleHz,
      stride:STRIDE,
      samples:[...this.samples],
      metadata:{...metadata,durationMs:metadata?.durationMs??lastTime}
    };
  }
}

export interface GhostPlaybackPose extends GhostPose {
  timeMs:number;
  done:boolean;
}

export class PoseGhostPlayer {
  private timeMs=0;
  constructor(readonly recording:GhostRecording,private readonly positionScale=DEFAULT_POSITION_SCALE){
    if(recording.schemaVersion!==1||recording.stride!==STRIDE)throw new Error("Unsupported ghost recording format");
  }

  reset():void{this.timeMs=0;}
  seek(timeMs:number):void{this.timeMs=Math.max(0,timeMs);}
  advance(deltaMs:number):GhostPlaybackPose|null{this.timeMs=Math.max(0,this.timeMs+deltaMs);return this.poseAt(this.timeMs);}

  poseAt(timeMs:number):GhostPlaybackPose|null{
    const s=this.recording.samples;
    const count=Math.floor(s.length/STRIDE);
    if(count===0)return null;
    const target=Math.max(0,timeMs);
    const firstTime=s[0]??0;
    const lastIndex=(count-1)*STRIDE;
    const lastTime=s[lastIndex]??0;
    if(target<=firstTime)return this.readPose(0,target,false);
    if(target>=lastTime)return this.readPose(lastIndex,target,true);

    let lo=0,hi=count-1;
    while(lo<hi-1){
      const mid=(lo+hi)>>1;
      const t=s[mid*STRIDE]??0;
      if(t<=target)lo=mid;else hi=mid;
    }
    const a=lo*STRIDE,b=hi*STRIDE;
    const ta=s[a]??0,tb=s[b]??ta;
    const f=tb>ta?(target-ta)/(tb-ta):0;
    const lerp=(offset:number)=>((s[a+offset]??0)+((s[b+offset]??0)-(s[a+offset]??0))*f)/this.positionScale;
    return{x:lerp(1),y:lerp(2),z:lerp(3),state:s[a+4]??0,timeMs:target,done:false};
  }

  get durationMs():number{
    const s=this.recording.samples;
    return s.length>=STRIDE?(s[s.length-STRIDE]??0):0;
  }

  private readPose(index:number,timeMs:number,done:boolean):GhostPlaybackPose{
    const s=this.recording.samples;
    return{
      x:(s[index+1]??0)/this.positionScale,
      y:(s[index+2]??0)/this.positionScale,
      z:(s[index+3]??0)/this.positionScale,
      state:s[index+4]??0,
      timeMs,
      done
    };
  }
}
