export interface MobileViewportOptions{rootSelector?:string;background?:string;includeSafeAreaPadding?:boolean;styleId?:string;}

/** Installs one shared dynamic-viewport/safe-area policy for standalone mobile web games. */
export function installMobileViewportPolicy(options:MobileViewportOptions={}):()=>void{
  if(typeof document==="undefined")return()=>{};
  const id=options.styleId??"slu-mobile-viewport";
  const existing=document.getElementById(id);if(existing)return()=>{};
  const root=options.rootSelector??"#game";
  const background=options.background??"#000";
  const style=document.createElement("style");style.id=id;
  style.textContent=`html,body{width:100%;height:100%;min-height:100dvh;background:${background};}body{position:fixed;inset:0;overflow:hidden;} ${root}{position:fixed;inset:0;width:100vw;height:100dvh;min-height:100dvh;${options.includeSafeAreaPadding===false?"":`padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);box-sizing:border-box;`}}`;
  document.head.appendChild(style);return()=>style.remove();
}
