export interface RecoveryUIOptions{
  root?:HTMLElement;
  message?:string;
  retryLabel?:string;
  menuLabel?:string;
  onRetry?:()=>void|Promise<void>;
  onMenu?:()=>void|Promise<void>;
}
export interface RecoveryUIHandle{show(message?:string):void;hide():void;dispose():void;}

/** Minimal player-safe recovery surface. Diagnostic detail stays out of player UI. */
export function mountRecoveryUI(options:RecoveryUIOptions={}):RecoveryUIHandle{
  if(typeof document==="undefined")return{show(){},hide(){},dispose(){}};
  const host=options.root??document.body;
  const wrap=document.createElement("div");wrap.hidden=true;wrap.setAttribute("role","alertdialog");wrap.setAttribute("aria-modal","true");wrap.style.cssText="position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;background:rgba(0,0,0,.82);font:14px/1.4 system-ui,sans-serif;color:white";
  const panel=document.createElement("div");panel.style.cssText="min-width:min(360px,calc(100vw - 40px));padding:24px;background:#111;border:1px solid #555";
  const message=document.createElement("p");message.textContent=options.message??"Something went wrong.";message.style.margin="0 0 18px";
  const actions=document.createElement("div");actions.style.cssText="display:flex;gap:10px";
  const retry=document.createElement("button");retry.type="button";retry.textContent=options.retryLabel??"Retry";
  const menu=document.createElement("button");menu.type="button";menu.textContent=options.menuLabel??"Menu";
  retry.addEventListener("click",()=>void options.onRetry?.());menu.addEventListener("click",()=>void options.onMenu?.());
  actions.append(retry,menu);panel.append(message,actions);wrap.append(panel);host.append(wrap);
  return{show(value){if(value)message.textContent=value;wrap.hidden=false;retry.focus();},hide(){wrap.hidden=true;},dispose(){wrap.remove();}};
}
