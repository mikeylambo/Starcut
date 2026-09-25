export type CertificationStatus="pass"|"fail"|"skip";
export interface CertificationCheckResult{status:CertificationStatus;name:string;message?:string;durationMs:number;}
export type CertificationCheck=()=>void|boolean|string|Promise<void|boolean|string>;
export interface CertificationProfile{name:string;checks:Record<string,CertificationCheck>;}
export interface CertificationReport{profile:string;ok:boolean;startedAt:string;finishedAt:string;results:CertificationCheckResult[];}

export class CertificationRunner{
  async run(profile:CertificationProfile):Promise<CertificationReport>{
    const startedAt=new Date();const results:CertificationCheckResult[]=[];
    for(const [name,check] of Object.entries(profile.checks)){
      const start=performance.now();
      try{
        const value=await check();
        if(value===false)results.push({status:"fail",name,message:"check returned false",durationMs:performance.now()-start});
        else if(typeof value==="string")results.push({status:"fail",name,message:value,durationMs:performance.now()-start});
        else results.push({status:"pass",name,durationMs:performance.now()-start});
      }catch(error){results.push({status:"fail",name,message:error instanceof Error?error.message:String(error),durationMs:performance.now()-start});}
    }
    const finishedAt=new Date();return{profile:profile.name,ok:results.every(result=>result.status!=="fail"),startedAt:startedAt.toISOString(),finishedAt:finishedAt.toISOString(),results};
  }
}

export const mergeCertificationProfiles=(name:string,...profiles:CertificationProfile[]):CertificationProfile=>({name,checks:Object.assign({},...profiles.map(profile=>profile.checks))});
