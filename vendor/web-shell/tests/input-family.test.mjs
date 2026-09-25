import test from "node:test";
import assert from "node:assert/strict";
import {gamepadFamily} from "../dist/index.js";

test("gamepad ids resolve to prompt families",()=>{
  assert.equal(gamepadFamily("Sony DualSense Wireless Controller"),"playstation");
  assert.equal(gamepadFamily("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)"),"xbox");
  assert.equal(gamepadFamily("Nintendo Switch Pro Controller"),"nintendo");
  assert.equal(gamepadFamily("USB Gamepad"),"generic-gamepad");
});
