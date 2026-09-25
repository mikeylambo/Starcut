export interface AchievementService{unlock(id:string):Promise<void>;}
export interface CloudSaveService{load(slot:string):Promise<unknown|null>;save(slot:string,data:unknown):Promise<void>;}
export interface LeaderboardService{submit(board:string,score:number,metadata?:Record<string,string|number|boolean>):Promise<void>;}
export interface IdentityService{currentUser():Promise<{id:string;displayName?:string}|null>;}
export interface PresenceService{setPresence(state:string,details?:Record<string,string>):Promise<void>;}
export interface EntitlementService{owns(id:string):Promise<boolean>;}

export interface PlatformServices{
  achievements:AchievementService;
  cloudSave:CloudSaveService;
  leaderboards:LeaderboardService;
  identity:IdentityService;
  presence:PresenceService;
  entitlements:EntitlementService;
}

export const createNoopPlatformServices=():PlatformServices=>({
  achievements:{unlock:async()=>{}},
  cloudSave:{load:async()=>null,save:async()=>{}},
  leaderboards:{submit:async()=>{}},
  identity:{currentUser:async()=>null},
  presence:{setPresence:async()=>{}},
  entitlements:{owns:async()=>false}
});
