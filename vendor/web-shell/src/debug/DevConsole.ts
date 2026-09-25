export interface DevCommandContext{args:string[];raw:string;}
export interface DevCommand{description?:string;run:(context:DevCommandContext)=>void|Promise<void|string>|string;}
export interface DevPanel{description?:string;read:()=>unknown|Promise<unknown>;}

export class DevConsoleRegistry{
  private readonly commands=new Map<string,DevCommand>();
  private readonly panels=new Map<string,DevPanel>();
  register(name:string,command:DevCommand):()=>void{const key=name.trim().toLowerCase();this.commands.set(key,command);return()=>this.commands.delete(key);}
  registerPanel(name:string,panel:DevPanel):()=>void{const key=name.trim();this.panels.set(key,panel);return()=>this.panels.delete(key);}
  list():readonly {name:string;description?:string}[]{return[...this.commands.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([name,command])=>({name,description:command.description}));}
  listPanels():readonly {name:string;description?:string}[]{return[...this.panels.entries()].map(([name,panel])=>({name,description:panel.description}));}
  async readPanel(name:string):Promise<unknown>{const panel=this.panels.get(name);if(!panel)throw new Error(`Unknown dev panel: ${name}`);return await panel.read();}
  async execute(line:string):Promise<string|void>{
    const raw=line.trim();if(!raw)return;
    const [name,...args]=raw.split(/\s+/);const command=this.commands.get((name??"").toLowerCase());
    if(!command)throw new Error(`Unknown dev command: ${name}`);
    return await command.run({args,raw});
  }
}

export interface MountedDevConsole{dispose():void;show():void;hide():void;toggle():void;refresh():Promise<void>;}

export function mountBrowserDevConsole(registry:DevConsoleRegistry,options:{hotkey?:string;title?:string;refreshMs?:number}={}):MountedDevConsole{
  if(typeof document==="undefined"||typeof window==="undefined")return{dispose(){},show(){},hide(){},toggle(){},async refresh(){}};
  const root=document.createElement("section");root.dataset.sluDevConsole="true";root.hidden=true;root.style.cssText="position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:rgba(4,8,12,.96);border:1px solid #4ddcff;color:#eaffff;font:12px/1.45 ui-monospace,monospace;padding:10px;max-height:55vh;box-shadow:0 12px 40px #0008";
  const head=document.createElement("div");head.textContent=options.title??"SLU DEV";head.style.cssText="font-weight:700;letter-spacing:.14em;margin-bottom:8px";
  const tabs=document.createElement("nav");tabs.style.cssText="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px";
  const body=document.createElement("div");
  const log=document.createElement("pre");log.style.cssText="white-space:pre-wrap;max-height:30vh;overflow:auto;margin:0 0 8px;color:#a9c8d4";
  const input=document.createElement("input");input.type="text";input.autocomplete="off";input.spellcheck=false;input.placeholder="command";input.style.cssText="width:100%;box-sizing:border-box;background:#08131c;color:white;border:1px solid #315266;padding:8px;font:inherit";
  const consolePane=document.createElement("div");consolePane.append(log,input);body.append(consolePane);root.append(head,tabs,body);document.body.append(root);
  let activePanel="Console";let interval:number|null=null;
  const print=(text:string)=>{log.textContent=`${log.textContent??""}${text}\n`;log.scrollTop=log.scrollHeight;};
  const format=(value:unknown)=>typeof value==="string"?value:JSON.stringify(value,null,2);
  const renderTabs=()=>{
    tabs.replaceChildren();
    const names=["Console",...registry.listPanels().map(panel=>panel.name)];
    for(const name of names){const button=document.createElement("button");button.type="button";button.textContent=name;button.dataset.active=String(name===activePanel);button.style.cssText=`border:1px solid ${name===activePanel?"#4ddcff":"#315266"};background:${name===activePanel?"#113544":"#08131c"};color:white;padding:5px 8px;font:inherit`;button.addEventListener("click",()=>{activePanel=name;renderTabs();void refresh();});tabs.append(button);}
  };
  const refresh=async()=>{
    if(activePanel==="Console"){if(body.firstChild!==consolePane)body.replaceChildren(consolePane);return;}
    let pre=body.querySelector("pre[data-panel]") as HTMLPreElement|null;
    if(!pre){pre=document.createElement("pre");pre.dataset.panel="true";pre.style.cssText="white-space:pre-wrap;max-height:38vh;overflow:auto;margin:0;color:#a9c8d4";body.replaceChildren(pre);}
    try{pre.textContent=format(await registry.readPanel(activePanel));}catch(error){pre.textContent=error instanceof Error?error.message:String(error);}
  };
  const submit=async()=>{const line=input.value.trim();if(!line)return;print(`> ${line}`);input.value="";try{const result=await registry.execute(line);if(result)print(result);}catch(error){print(error instanceof Error?error.message:String(error));}};
  input.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();void submit();}});
  const show=()=>{root.hidden=false;renderTabs();void refresh();if(activePanel==="Console")input.focus();if(options.refreshMs&&interval===null)interval=window.setInterval(()=>void refresh(),Math.max(100,options.refreshMs));};
  const hide=()=>{root.hidden=true;if(interval!==null){window.clearInterval(interval);interval=null;}};
  const hotkey=options.hotkey??"F1";const onKey=(event:KeyboardEvent)=>{if(event.key===hotkey){event.preventDefault();root.hidden?show():hide();}};window.addEventListener("keydown",onKey);
  renderTabs();
  return{dispose(){hide();window.removeEventListener("keydown",onKey);root.remove();},show,hide,toggle(){root.hidden?show():hide();},refresh};
}
