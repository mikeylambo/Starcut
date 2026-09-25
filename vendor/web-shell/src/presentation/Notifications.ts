import { EventBus } from "../core/EventBus.js";

export type NotificationKind="info"|"success"|"warning"|"error"|"achievement"|"unlock";
export interface Notification{ id:string;kind:NotificationKind;title:string;body?:string;durationMs?:number;iconId?:string;priority?:number; }
export interface NotificationEvents{"notification:show":Notification;"notification:dismiss":{id:string};[key:string]:unknown;}

export class NotificationCenter{
  readonly events=new EventBus<NotificationEvents>();private readonly active=new Map<string,Notification>();
  show(notification:Notification):void{const item=structuredClone(notification);this.active.set(item.id,item);this.events.emit("notification:show",item);}
  dismiss(id:string):boolean{const removed=this.active.delete(id);if(removed)this.events.emit("notification:dismiss",{id});return removed;}
  clear():void{for(const id of [...this.active.keys()])this.dismiss(id);}
  list():Notification[]{return[...this.active.values()].sort((a,b)=>(b.priority??0)-(a.priority??0)).map(item=>structuredClone(item));}
}
