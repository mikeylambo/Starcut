export type MessageTable=Record<string,string>;
export interface LocalizationOptions{defaultLocale:string;fallbackLocale?:string;strict?:boolean;}

export class LocalizationRegistry{
  private readonly tables=new Map<string,MessageTable>();
  private readonly missingKeys=new Set<string>();
  private locale:string;
  constructor(private readonly options:LocalizationOptions){this.locale=options.defaultLocale;}
  register(locale:string,table:MessageTable):void{this.tables.set(locale,{...(this.tables.get(locale)??{}),...table});}
  setLocale(locale:string):void{this.locale=locale;}
  getLocale():string{return this.locale;}
  has(key:string,locale=this.locale):boolean{return key in (this.tables.get(locale)??{});}
  t(key:string,vars:Record<string,string|number>={}):string{
    const fallback=this.options.fallbackLocale??this.options.defaultLocale;
    const value=this.tables.get(this.locale)?.[key]??this.tables.get(fallback)?.[key];
    if(value===undefined){this.missingKeys.add(`${this.locale}:${key}`);if(this.options.strict)throw new Error(`Missing localization key: ${key} (${this.locale})`);return key;}
    return value.replace(/\{([\w.-]+)\}/g,(_,name:string)=>String(vars[name]??`{${name}}`));
  }
  missing():readonly string[]{return [...this.missingKeys].sort();}
  auditKeys(required:Iterable<string>,locales:Iterable<string>=this.tables.keys()):Record<string,string[]>{
    const result:Record<string,string[]>={};
    for(const locale of locales){const table=this.tables.get(locale)??{};const missing=[...required].filter(key=>!(key in table));if(missing.length)result[locale]=missing;}
    return result;
  }
}

export function pseudoLocalize(text:string,expansion=0.35):string{
  const map:Record<string,string>={a:"á",e:"ë",i:"ï",o:"ô",u:"ü",A:"Á",E:"Ë",I:"Ï",O:"Ö",U:"Û"};
  const transformed=[...text].map(c=>map[c]??c).join("");
  const pad="~".repeat(Math.max(1,Math.ceil(text.length*expansion)));
  return `[${transformed}${pad}]`;
}
