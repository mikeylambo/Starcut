export type ValidationSeverity="error"|"warning";
export interface ValidationIssue{severity:ValidationSeverity;code:string;message:string;path?:string;}
export interface ValidationResult{ok:boolean;issues:ValidationIssue[];}
export type ContentRule<T>=(value:T)=>ValidationIssue[];

export class ContentValidator<T>{
  private readonly rules:ContentRule<T>[]=[];
  use(rule:ContentRule<T>):this{this.rules.push(rule);return this;}
  validate(value:T):ValidationResult{const issues=this.rules.flatMap(rule=>rule(value));return{ok:!issues.some(issue=>issue.severity==="error"),issues};}
}

export const uniqueBy=<T>(items:readonly T[],key:(item:T)=>string,path="items"):ValidationIssue[]=>{
  const seen=new Set<string>();const issues:ValidationIssue[]=[];
  items.forEach((item,index)=>{const id=key(item);if(seen.has(id))issues.push({severity:"error",code:"duplicate-id",message:`Duplicate id '${id}'`,path:`${path}[${index}]`});seen.add(id);});
  return issues;
};

export const requiredReference=(id:string|undefined,available:ReadonlySet<string>,path:string,label="reference"):ValidationIssue[]=>{
  if(!id)return[{severity:"error",code:"missing-reference",message:`Missing ${label}`,path}];
  return available.has(id)?[]:[{severity:"error",code:"invalid-reference",message:`Unknown ${label} '${id}'`,path}];
};
