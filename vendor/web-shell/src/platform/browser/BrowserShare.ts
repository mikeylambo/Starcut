export interface SharePayload{title:string;text?:string;url?:string;files?:File[];}
export interface ShareResult{method:"native"|"clipboard"|"none";shared:boolean;}

/** Browser share helper generalized from Descent's results-screen sharing flow. */
export class BrowserShare{
  async share(payload:SharePayload):Promise<ShareResult>{
    if(typeof navigator==="undefined")return{method:"none",shared:false};
    try{
      if(typeof navigator.share==="function"){
        const data:ShareData={title:payload.title,text:payload.text,url:payload.url};
        if(payload.files?.length&&navigator.canShare?.({files:payload.files}))data.files=payload.files;
        await navigator.share(data);return{method:"native",shared:true};
      }
    }catch(error){if(error instanceof DOMException&&error.name==="AbortError")return{method:"native",shared:false};}
    const fallback=[payload.text,payload.url].filter(Boolean).join(" ");
    try{if(fallback&&navigator.clipboard?.writeText){await navigator.clipboard.writeText(fallback);return{method:"clipboard",shared:true};}}catch{}
    return{method:"none",shared:false};
  }
}
