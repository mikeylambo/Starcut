import test from "node:test";
import assert from "node:assert/strict";
import {AudioMixer,MemoryStorage,SettingsStore,bindAudioSettings} from "../dist/index.js";

class FakeAudio{
  volumes=new Map();muted=false;
  setBusVolume(bus,value){this.volumes.set(bus,value);}
  setMuted(value){this.muted=value;}
}

test("audio mixer applies standard buses and reversible ducking",()=>{
  const audio=new FakeAudio();const mixer=new AudioMixer(audio);
  mixer.setVolume("music",0.8);
  const release=mixer.duck("dialogue",["music","ambience"],0.25);
  assert.equal(audio.volumes.get("music"),0.2);
  release();
  assert.equal(audio.volumes.get("music"),0.8);
});

test("core audio settings stay synchronized with mixer",async()=>{
  const audio=new FakeAudio();const mixer=new AudioMixer(audio);
  const settings=SettingsStore.core(new MemoryStorage());
  const unbind=bindAudioSettings(settings,mixer);
  await settings.patch({masterVolume:0.5,musicVolume:0.4,muted:true});
  assert.equal(audio.volumes.get("master"),0.5);
  assert.equal(audio.volumes.get("music"),0.4);
  assert.equal(audio.muted,true);
  unbind();
});
