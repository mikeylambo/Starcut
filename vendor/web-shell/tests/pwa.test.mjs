import test from "node:test";
import assert from "node:assert/strict";
import {validateWebManifest,PWAController} from "../dist/index.js";

test("web manifest validation enforces install icon baseline",()=>{
  const valid={name:"Game",short_name:"Game",icons:[
    {src:"192.png",sizes:"192x192",type:"image/png"},
    {src:"512.png",sizes:"512x512",type:"image/png"}
  ]};
  assert.deepEqual(validateWebManifest(valid),[]);
  assert.match(validateWebManifest({name:"Game",short_name:"Game",icons:[]})[0],/192x192/);
});

test("PWA controller degrades safely outside a browser service-worker runtime",async()=>{
  const controller=new PWAController();
  assert.equal(await controller.promptInstall(),"unavailable");
});
