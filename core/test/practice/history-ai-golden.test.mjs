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
for(const memory of [false,true])test(`AI metadata survives new history rounds and finish (${memory?'memory':'disk'})`,async()=>{
  const {bytes,checks,payloadPairs}=await runHistoryAiScenario(codeRoot,{memory});
  const golden=fs.readFileSync(new URL(`../fixtures/history-ai-${memory?'memory':'disk'}-d3505cf.json`,import.meta.url));
  const paths=differences(JSON.parse(golden),JSON.parse(bytes));
  assert.ok(bytes.equals(golden),'baseline byte mismatch at JSON paths:\n'+paths.join('\n'));
  for(const pair of payloadPairs)assert.ok(jsonBytes(pair.actual).equals(jsonBytes(pair.expected)),pair.name+': internal view differs from public unsubmittedState');
  for(const name of ['wholeAutomatic','targetAutomatic'])assert.ok(checks.includes(name+'/legacy-auto-completed'));
});
