export type EntitlementState="demo"|"full";

export interface EntitlementRule {
  id:string;
  demoAllowed?:boolean;
  requiredFeature?:string;
}

/** Small release gate for free-demo/full-game SKUs. Games register semantic
 * content ids or features and ask the shell whether the active entitlement may
 * enter them. Store/platform ownership can update the state at runtime. */
export class EntitlementManager {
  private state:EntitlementState;
  private readonly rules=new Map<string,EntitlementRule>();
  private readonly features=new Set<string>();

  constructor(initial:EntitlementState="full"){this.state=initial;}
  setState(state:EntitlementState):void{this.state=state;}
  get current():EntitlementState{return this.state;}

  register(rules:readonly EntitlementRule[]):void{for(const rule of rules)this.rules.set(rule.id,{...rule});}
  grantFeature(id:string):void{this.features.add(id);}
  revokeFeature(id:string):void{this.features.delete(id);}
  hasFeature(id:string):boolean{return this.features.has(id);}

  allows(id:string):boolean{
    const rule=this.rules.get(id);
    if(!rule)return this.state==="full";
    if(rule.requiredFeature&&!this.features.has(rule.requiredFeature))return false;
    if(this.state==="full")return true;
    return rule.demoAllowed===true;
  }

  assertAllowed(id:string):void{if(!this.allows(id))throw new Error(`Content is not available for the active entitlement: ${id}`);}
}
