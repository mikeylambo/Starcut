import type { ItemDefinition } from "../inventory/InventoryManager.js";
export interface EquipmentSlot{ id:string;acceptsTags?:string[]; }
export class EquipmentManager{
  private slots=new Map<string,EquipmentSlot>();private equipped=new Map<string,ItemDefinition>();
  constructor(slots:readonly EquipmentSlot[]){for(const s of slots)this.slots.set(s.id,structuredClone(s));}
  equip(slotId:string,item:ItemDefinition):void{const s=this.slots.get(slotId);if(!s)throw new Error(`Unknown equipment slot: ${slotId}`);if(s.acceptsTags?.length&&!item.tags?.some(t=>s.acceptsTags!.includes(t)))throw new Error(`${item.id} cannot equip to ${slotId}`);this.equipped.set(slotId,structuredClone(item));}
  unequip(slotId:string):ItemDefinition|undefined{const i=this.equipped.get(slotId);this.equipped.delete(slotId);return i?structuredClone(i):undefined;}
  snapshot():Record<string,ItemDefinition>{return Object.fromEntries([...this.equipped].map(([k,v])=>[k,structuredClone(v)]));}
}
