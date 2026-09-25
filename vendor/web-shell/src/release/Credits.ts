export interface CreditEntry { role:string; names:string[]; section?:string; note?:string; }
export interface CreditsDocument { title?:string; entries:CreditEntry[]; legal?:string[]; }

export class CreditsRegistry {
  private document:CreditsDocument={entries:[]};
  set(document:CreditsDocument):void{this.document=structuredClone(document);}
  add(entry:CreditEntry):void{this.document.entries.push(structuredClone(entry));}
  snapshot():CreditsDocument{return structuredClone(this.document);}
  sections():string[]{return[...new Set(this.document.entries.map(entry=>entry.section??"Credits"))];}
  bySection(section:string):CreditEntry[]{return this.document.entries.filter(entry=>(entry.section??"Credits")===section).map(entry=>structuredClone(entry));}
}
