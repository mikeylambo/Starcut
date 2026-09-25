export interface RulesetDefinition{ id:string;label:string;values:Record<string,unknown>; }
export class RulesetManager{
  private rules=new Map<string,RulesetDefinition>();private activeId:string|null=null;
  register(rules:readonly RulesetDefinition[]):void{for(const r of rules)this.rules.set(r.id,structuredClone(r));}
  activate(id:string):RulesetDefinition{const r=this.rules.get(id);if(!r)throw new Error(`Unknown ruleset: ${id}`);this.activeId=id;return structuredClone(r);}
  active():RulesetDefinition|null{return this.activeId?structuredClone(this.rules.get(this.activeId)??null):null;}
}
