import { runSmokeFlow,type SmokeReport } from "./FlowSmoke.js";

export interface FlowHarnessAdapter{
  boot():void|Promise<void>;
  openMenu?():void|Promise<void>;
  startGame():void|Promise<void>;
  pause():void|Promise<void>;
  resume():void|Promise<void>;
  finishRun?():void|Promise<void>;
  openResults?():void|Promise<void>;
  retry?():void|Promise<void>;
  quit():void|Promise<void>;
  phase():string;
}

export interface FlowHarnessOptions{
  expected?:Partial<Record<"boot"|"menu"|"play"|"pause"|"resume"|"results"|"retry"|"quit",string>>;
  includeResults?:boolean;
  includeRetry?:boolean;
}

/** Canonical automated shell flow: boot -> menu -> play -> pause -> resume -> results -> retry -> quit. */
export async function runCanonicalGameFlow(adapter:FlowHarnessAdapter,options:FlowHarnessOptions={}):Promise<SmokeReport>{
  const expected={boot:"title",menu:"menu",play:"playing",pause:"paused",resume:"playing",results:"results",retry:"playing",quit:"menu",...(options.expected??{})};
  const steps=[
    {label:"boot",run:()=>adapter.boot(),assert:()=>adapter.phase()===expected.boot||`expected ${expected.boot}, got ${adapter.phase()}`},
    ...(adapter.openMenu?[{label:"menu",run:()=>adapter.openMenu!(),assert:()=>adapter.phase()===expected.menu||`expected ${expected.menu}, got ${adapter.phase()}`}]:[]),
    {label:"play",run:()=>adapter.startGame(),assert:()=>adapter.phase()===expected.play||`expected ${expected.play}, got ${adapter.phase()}`},
    {label:"pause",run:()=>adapter.pause(),assert:()=>adapter.phase()===expected.pause||`expected ${expected.pause}, got ${adapter.phase()}`},
    {label:"resume",run:()=>adapter.resume(),assert:()=>adapter.phase()===expected.resume||`expected ${expected.resume}, got ${adapter.phase()}`},
    ...((options.includeResults!==false&&adapter.finishRun&&adapter.openResults)?[
      {label:"finish",run:()=>adapter.finishRun!()},
      {label:"results",run:()=>adapter.openResults!(),assert:()=>adapter.phase()===expected.results||`expected ${expected.results}, got ${adapter.phase()}`}
    ]:[]),
    ...((options.includeRetry&&adapter.retry)?[{label:"retry",run:()=>adapter.retry!(),assert:()=>adapter.phase()===expected.retry||`expected ${expected.retry}, got ${adapter.phase()}`}]:[]),
    {label:"quit",run:()=>adapter.quit(),assert:()=>adapter.phase()===expected.quit||`expected ${expected.quit}, got ${adapter.phase()}`}
  ];
  return runSmokeFlow(steps);
}
