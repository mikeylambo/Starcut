import { LocalizationRegistry } from "./Localization.js";

export type PlayerCopyPurpose="action"|"state"|"consequence"|"navigation"|"instruction"|"fiction";
export interface PlayerCopyEntry{key:string;purpose:PlayerCopyPurpose;defaultText:string;notes?:string;}
export interface PlayerCopyAudit{registered:number;used:number;unused:string[];missingLocalization:Record<string,string[]>;}

/**
 * Strict registry for player-facing text. A string must declare why it exists before
 * it can be resolved. Decorative system names, taglines, and filler have no purpose
 * category and therefore do not belong here unless the game explicitly approves them
 * as essential fiction.
 */
export class PlayerCopyCatalog{
  private readonly entries=new Map<string,PlayerCopyEntry>();
  private readonly usage=new Map<string,number>();
  constructor(readonly localization:LocalizationRegistry,private readonly defaultLocale="en"){}
  register(entries:readonly PlayerCopyEntry[]):void{
    const table:Record<string,string>={};
    for(const entry of entries){
      if(this.entries.has(entry.key))throw new Error(`Duplicate player copy key: ${entry.key}`);
      if(!entry.defaultText.trim())throw new Error(`Player copy '${entry.key}' is empty`);
      this.entries.set(entry.key,{...entry});table[entry.key]=entry.defaultText;
    }
    this.localization.register(this.defaultLocale,table);
  }
  text(key:string,vars:Record<string,string|number>={}):string{
    if(!this.entries.has(key))throw new Error(`Unregistered player-facing copy: ${key}`);
    this.usage.set(key,(this.usage.get(key)??0)+1);
    return this.localization.t(key,vars);
  }
  entry(key:string):PlayerCopyEntry|undefined{const value=this.entries.get(key);return value?{...value}:undefined;}
  keys():string[]{return[...this.entries.keys()].sort();}
  audit(locales:Iterable<string>=[this.localization.getLocale()]):PlayerCopyAudit{
    const keys=this.keys();return{registered:keys.length,used:[...this.usage.values()].filter(count=>count>0).length,unused:keys.filter(key=>(this.usage.get(key)??0)===0),missingLocalization:this.localization.auditKeys(keys,locales)};
  }
}

export function createPlayerCopyCatalog(entries:readonly PlayerCopyEntry[],options:{locale?:string;strict?:boolean}={}):PlayerCopyCatalog{
  const locale=options.locale??"en";const localization=new LocalizationRegistry({defaultLocale:locale,fallbackLocale:locale,strict:options.strict??true});const catalog=new PlayerCopyCatalog(localization,locale);catalog.register(entries);return catalog;
}
