import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runHistoryAiScenario} from '../../scripts/dev/history-ai-golden-scenario.mjs';
import {jsonBytes} from '../../server/host/platform/json.js';

const codeRoot=fileURLToPath(new URL('../../',import.meta.url));
function differences(expected,actual,path='') {
  if(expected===actual)return [];
  if(expected&&actual&&typeof expected==='object'&&typeof actual==='object')return [...new Set([...Object.keys(expected),...Object.keys(actual)])].flatMap(key=>differences(expected[key],actual[key],path+'/'+key));
  return [path];
}
for(const memory of [false,true])test(`AI metadata survives new history rounds and finish (${memory?'memory':'disk'})`,async t=>{
  const {bytes,checks,payloadPairs}=await runHistoryAiScenario(codeRoot,{memory});
  const golden=fs.readFileSync(new URL(`../fixtures/history-ai-${memory?'memory':'disk'}-d3505cf.json`,import.meta.url));
  const paths=differences(JSON.parse(golden),JSON.parse(bytes));
  await t.test('complete state bytes match the unchanged d3505cf fixture',()=>assert.ok(bytes.equals(golden),'baseline byte mismatch at JSON paths:\n'+paths.join('\n')));
  for(const pair of payloadPairs)await t.test(pair.name+': all optional fields produce the same payload through public and private views',()=>{
    assert.ok(jsonBytes(pair.actual).equals(jsonBytes(pair.expected)),'internal view differs from public unsubmittedState');
    assert.deepEqual(pair.actual.aiTask,{taskId:'a'.repeat(64)});assert.deepEqual(pair.actual.aiTasks,{p0:'b'.repeat(64)});
    assert.equal(Object.hasOwn(pair.actual.state,'answerState'),pair.name==='allOptionalDraft');
  });
  for(const name of ['wholeAutomatic','targetAutomatic'])assert.ok(checks.includes(name+'/legacy-auto-completed'));
});
