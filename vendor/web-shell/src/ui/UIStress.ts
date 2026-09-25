import { pseudoLocalize } from "../localization/Localization.js";

export interface UIStressOptions{expandText?:boolean;textExpansion?:number;rtl?:boolean;textScale?:number;}

export function applyUIStress(root:HTMLElement,options:UIStressOptions={}):()=>void{
  const changedText:{node:Text;value:string}[]=[];
  const originalDirection=root.dir;const originalFontSize=root.style.fontSize;
  if(options.expandText){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let current=walker.nextNode();
    while(current){const text=current as Text;if(text.nodeValue?.trim()){changedText.push({node:text,value:text.nodeValue});text.nodeValue=pseudoLocalize(text.nodeValue,options.textExpansion??0.35);}current=walker.nextNode();}
  }
  if(options.rtl)root.dir="rtl";
  if(options.textScale&&options.textScale>0)root.style.fontSize=`${options.textScale*100}%`;
  return()=>{for(const item of changedText)item.node.nodeValue=item.value;root.dir=originalDirection;root.style.fontSize=originalFontSize;};
}
