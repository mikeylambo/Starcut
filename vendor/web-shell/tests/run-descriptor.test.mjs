import test from "node:test";
import assert from "node:assert/strict";
import {createRunDescriptor,runMetadata} from "../dist/index.js";

test("run descriptor gives replay, ghost, telemetry and leaderboard systems one identity",()=>{
  const run=createRunDescriptor({
    gameId:"blinkfall",version:"1.1.0",modeId:"daily",levelId:"sector-1",difficultyId:"fall-3",seed:"ABC123",challengeKey:"daily:2026-09-11",startedAt:"2026-09-11T12:00:00.000Z"
  });
  assert.equal(run.schemaVersion,1);
  assert.ok(run.runId.startsWith("blinkfall-"));
  assert.deepEqual(runMetadata(run),{
    runId:run.runId,gameId:"blinkfall",version:"1.1.0",modeId:"daily",levelId:"sector-1",difficultyId:"fall-3",seed:"ABC123",challengeKey:"daily:2026-09-11"
  });
});

test("identical run inputs at identical start time yield identical ids",()=>{
  const input={gameId:"descent",version:"1",seed:42,startedAt:"2026-09-11T12:00:00.000Z"};
  assert.equal(createRunDescriptor(input).runId,createRunDescriptor(input).runId);
});
