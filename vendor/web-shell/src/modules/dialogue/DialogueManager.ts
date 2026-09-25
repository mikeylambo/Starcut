import { EventBus } from "../../core/EventBus.js";
export interface DialogueChoice{ id:string;label:string;next?:string; }
export interface DialogueNode{ id:string;speaker?:string;text:string;choices?:DialogueChoice[];next?:string;actions?:string[]; }
export interface DialogueEvents{"dialogue:node":DialogueNode;"dialogue:ended":undefined;[key:string]:unknown;}
export class DialogueManager{
  readonly events=new EventBus<DialogueEvents>();private nodes=new Map<string,DialogueNode>();private currentId:string|null=null;
  register(nodes:readonly DialogueNode[]):void{for(const n of nodes)this.nodes.set(n.id,structuredClone(n));}
  start(id:string):DialogueNode{return this.goto(id);}
  choose(choiceId:string):DialogueNode|null{const node=this.requireCurrent();const choice=node.choices?.find(c=>c.id===choiceId);if(!choice)throw new Error(`Unknown dialogue choice: ${choiceId}`);return choice.next?this.goto(choice.next):this.end();}
  advance():DialogueNode|null{const node=this.requireCurrent();return node.next?this.goto(node.next):this.end();}
  private goto(id:string):DialogueNode{const n=this.nodes.get(id);if(!n)throw new Error(`Unknown dialogue node: ${id}`);this.currentId=id;const copy=structuredClone(n);this.events.emit("dialogue:node",copy);return copy;}
  private end():null{this.currentId=null;this.events.emit("dialogue:ended",undefined);return null;}
  private requireCurrent():DialogueNode{if(!this.currentId)throw new Error("No active dialogue");return this.nodes.get(this.currentId)!;}
}
