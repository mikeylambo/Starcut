export interface MoveDefinition{id:string;label:string;input:string;description?:string;tags?:string[];unlockId?:string;}
export class MoveList{
  private moves=new Map<string,MoveDefinition>();
  register(moves:readonly MoveDefinition[]):void{for(const m of moves)this.moves.set(m.id,structuredClone(m));}
  list(isUnlocked:(id:string)=>boolean=()=>true):MoveDefinition[]{return [...this.moves.values()].filter(m=>!m.unlockId||isUnlocked(m.unlockId)).map(m=>structuredClone(m));}
}
