export interface CaptureResult{ id:string;mimeType:string;data?:Blob|string;metadata?:Record<string,string|number|boolean>; }
export interface CaptureAdapter{ capture(id:string,options?:Record<string,unknown>):Promise<CaptureResult>; }
export class CaptureService{
  constructor(private readonly adapter?:CaptureAdapter){}
  async capture(id:string,options?:Record<string,unknown>):Promise<CaptureResult>{if(!this.adapter)throw new Error("No capture adapter configured");return this.adapter.capture(id,options);}
}
