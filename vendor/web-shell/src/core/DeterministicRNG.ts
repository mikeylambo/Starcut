export function stableHashString(value:string):number{let h=0x811c9dc5;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,0x01000193);}return h>>>0;}

export class DeterministicRng{
  private stateValue:number;private draws=0;
  constructor(seed:number){this.stateValue=seed>>>0;}
  next():number{this.draws++;let t=(this.stateValue+=0x6d2b79f5);t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;}
  range(min:number,max:number):number{return min+this.next()*(max-min);}
  int(min:number,max:number):number{return Math.floor(this.range(min,max+1));}
  chance(probability:number):boolean{return this.next()<probability;}
  pick<T>(items:readonly T[]):T{if(items.length===0)throw new Error("Cannot pick from empty array");return items[Math.floor(this.next()*items.length)]!;}
  weighted<T>(items:readonly T[],weights:readonly number[]):T{if(items.length===0||items.length!==weights.length)throw new Error("Weighted pick requires equally sized non-empty arrays");let total=0;for(const weight of weights)total+=Math.max(0,weight);if(total<=0)throw new Error("Weighted pick requires positive total weight");let r=this.next()*total;for(let i=0;i<items.length;i++){r-=Math.max(0,weights[i]!);if(r<=0)return items[i]!;}return items.at(-1)!;}
  shuffle<T>(items:T[]):T[]{for(let i=items.length-1;i>0;i--){const j=Math.floor(this.next()*(i+1));[items[i],items[j]]=[items[j]!,items[i]!];}return items;}
  get cursor():number{return this.draws;}
  get state():number{return this.stateValue>>>0;}
}

/** Independent named streams prevent one subsystem's random draws from perturbing another. */
export class DeterministicRngRegistry<TName extends string=string>{
  private readonly streams=new Map<TName,DeterministicRng>();private masterSeed=0;private seedText="";
  constructor(private readonly names:readonly TName[]){ }
  init(seed:number|string):void{this.seedText=typeof seed==="string"?seed:String(seed);this.masterSeed=typeof seed==="string"?stableHashString(seed):seed>>>0;this.streams.clear();for(const name of this.names)this.streams.set(name,new DeterministicRng(stableHashString(`${this.masterSeed}:${name}`)));}
  stream(name:TName):DeterministicRng{let stream=this.streams.get(name);if(!stream){stream=new DeterministicRng(stableHashString(`${this.masterSeed}:${name}`));this.streams.set(name,stream);}return stream;}
  cursors():Record<string,number>{return Object.fromEntries(this.names.map(name=>[name,this.stream(name).cursor]));}
  states():Record<string,number>{return Object.fromEntries(this.names.map(name=>[name,this.stream(name).state]));}
  snapshot():{seed:string;masterSeed:number;cursors:Record<string,number>;states:Record<string,number>}{return{seed:this.seedText,masterSeed:this.masterSeed,cursors:this.cursors(),states:this.states()};}
  static freshSeed(length=6):string{const alphabet="ACDEFGHJKLMNPQRTUVWXY3479";let out="";let n=(Date.now()^Math.floor((typeof performance!=="undefined"?performance.now():0)*1000))>>>0;for(let i=0;i<length;i++){out+=alphabet[n%alphabet.length];n=Math.imul(n^(n>>>13),0x5bd1e995)>>>0;}return out;}
}
