export interface ItemDefinition { id:string;label:string;stackable?:boolean;maxStack?:number;tags?:string[];metadata?:Record<string,unknown>; }
export interface InventoryStack { itemId:string;quantity:number; }
export class InventoryManager{
  private definitions=new Map<string,ItemDefinition>();private stacks=new Map<string,number>();
  register(items:readonly ItemDefinition[]):void{for(const i of items)this.definitions.set(i.id,structuredClone(i));}
  add(id:string,quantity=1):number{
    const d=this.require(id);const current=this.stacks.get(id)??0;
    const max=d.stackable===false?1:(d.maxStack??Number.MAX_SAFE_INTEGER);const next=Math.min(max,current+quantity);this.stacks.set(id,next);return next;
  }
  remove(id:string,quantity=1):number{const current=this.stacks.get(id)??0;const next=Math.max(0,current-quantity);if(next===0)this.stacks.delete(id);else this.stacks.set(id,next);return next;}
  count(id:string):number{return this.stacks.get(id)??0;} has(id:string,q=1):boolean{return this.count(id)>=q;}
  list():InventoryStack[]{return [...this.stacks].map(([itemId,quantity])=>({itemId,quantity}));}
  definition(id:string):ItemDefinition|undefined{const d=this.definitions.get(id);return d?structuredClone(d):undefined;}
  private require(id:string):ItemDefinition{const d=this.definitions.get(id);if(!d)throw new Error(`Unknown item: ${id}`);return d;}
}
