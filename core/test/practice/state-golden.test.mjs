import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runScenario} from '../../scripts/dev/state-golden-scenario.mjs';

const codeRoot=fileURLToPath(new URL('../../',import.meta.url));
const deeplyFrozen=value=>{if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value));for(const child of Object.values(value))deeplyFrozen(child);}};
for(const memory of [false,true])test(`deterministic state scenario preserves old graphs, rollback and frozen commits (${memory?'memory':'disk'})`,async()=>{
  const observed=[];
  const result=await runScenario(codeRoot,{memory,observe:({label,before,after})=>{
    deeplyFrozen(before);deeplyFrozen(after);observed.push(label);
    if(['draft:first','whiteboard:q001','draft:q001','bind:target','bind:whole','retry:q002'].includes(label)) {
      assert.notEqual(after,before);assert.notEqual(after.questions,before.questions);
      assert.equal(after.questions.q020,before.questions.q020,'untouched question is shared');
      assert.equal(after.historyRounds,before.historyRounds,'untouched history is shared');
    }
    if(label.startsWith('review:')||label==='confirm-ai'){
      assert.equal(after.questions.q020,before.questions.q020);
      assert.equal(after.historyRounds[0],before.historyRounds[0]);
      assert.notEqual(after.historyRounds.at(-1),before.historyRounds.at(-1));
    }
  }});
  assert.equal(result.questions,20);
  for(const label of ['replay','rule-rejected','submit:q001','submit:q002','review:q001','review:q003','bind:target','bind:whole','confirm-ai','finish','restart'])assert.ok(observed.includes(label),label);
  if(!memory){assert.ok(observed.includes('write-failed'));assert.ok(result.bytes.equals(fs.readFileSync(new URL('../fixtures/state-golden-d3505cf.json',import.meta.url))),'persisted bytes differ from d3505cf golden');}
});
