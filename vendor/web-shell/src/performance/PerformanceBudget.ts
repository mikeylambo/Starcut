export interface PerformanceMetrics{frameMs?:number;fps?:number;drawCalls?:number;triangles?:number;textureBytes?:number;heapBytes?:number;bundleBytes?:number;}
export interface PerformanceBudget extends PerformanceMetrics{}
export interface BudgetViolation{metric:keyof PerformanceMetrics;actual:number;budget:number;ratio:number;}
export interface BudgetReport{ok:boolean;violations:BudgetViolation[];}

export function evaluatePerformanceBudget(metrics:PerformanceMetrics,budget:PerformanceBudget):BudgetReport{
  const violations:BudgetViolation[]=[];
  for(const key of Object.keys(budget) as (keyof PerformanceMetrics)[]){
    const limit=budget[key];const actual=metrics[key];if(limit===undefined||actual===undefined)continue;
    const exceeds=key==="fps"?actual<limit:actual>limit;
    if(exceeds)violations.push({metric:key,actual,budget:limit,ratio:key==="fps"?limit/Math.max(actual,0.0001):actual/Math.max(limit,0.0001)});
  }
  return{ok:violations.length===0,violations};
}

export class FrameTimeSampler{
  private samples:number[]=[];
  constructor(private readonly maxSamples=240){}
  push(frameMs:number):void{if(Number.isFinite(frameMs)&&frameMs>=0){this.samples.push(frameMs);if(this.samples.length>this.maxSamples)this.samples.shift();}}
  summary():{count:number;meanMs:number;p95Ms:number;worstMs:number;fps:number}{
    if(!this.samples.length)return{count:0,meanMs:0,p95Ms:0,worstMs:0,fps:0};
    const sorted=[...this.samples].sort((a,b)=>a-b);const meanMs=this.samples.reduce((a,b)=>a+b,0)/this.samples.length;const p95Ms=sorted[Math.min(sorted.length-1,Math.floor(sorted.length*0.95))]??0;const worstMs=sorted.at(-1)??0;return{count:this.samples.length,meanMs,p95Ms,worstMs,fps:meanMs>0?1000/meanMs:0};
  }
}
