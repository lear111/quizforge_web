// Isolated diagnostic: time only the outer freeze call. No production flags,
// timing phases or source files are changed; recursive calls remain unwrapped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const codeRoot=fileURLToPath(new URL('../../',import.meta.url));
const target=new URL('../../server/host/platform/json.js',import.meta.url).href;
registerHooks({load(url,context,next){
  const result=next(url,context);if(url!==target)return result;
  const source=String(result.source), start=source.indexOf('export function freezeJson('), end=source.indexOf('\nexport function fingerprint(',start);
  if(start<0||end<0)throw Error('Freeze diagnostic anchor changed');
  const inner=source.slice(start,end).replace('export function','function').replaceAll('freezeJson(', 'freezeGraph(');
  const wrapper=`export function freezeJson(value, options) {
    const start=process.hrtime.bigint();
    try {return freezeGraph(value,options);} finally {
      globalThis.__qfFreezeProbe?.({whole:options?.incremental===false,ms:Number(process.hrtime.bigint()-start)/1e6});
    }
  }\n`;
  return {...result,source:source.slice(0,start)+inner+wrapper+source.slice(end)};
}});
const [{RuleEngine},{Library},{StateStore},{perfAnswer},{summarizeSamples}]=await Promise.all([
  import('../../server/host/extensions/rule-engine.js'),import('../../server/host/library/library.js'),import('../../server/host/practice/state-store.js'),import('./create-perf-fixture.mjs'),import('./measure-perf.mjs')
]);
export async function measureFreeze(seed,{runs=3,count=20}={}){
  const fixture=JSON.parse(fs.readFileSync(path.join(seed,'perf-fixture.json')));assert.equal(fixture.fixture,'quizforge-perf-a1-v2');
  const stateFile=path.join(seed,fixture.stateFile), digest=()=>createHash('sha256').update(fs.readFileSync(stateFile)).digest('hex'), before=digest();
  const samples={load:[],draft:[]};
  for(let run=0;run<runs;run++){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'qf-freeze-measure-'));let engine,library;
    try{
      for(const directory of ['extensions','question-banks','.state'])fs.cpSync(path.join(seed,directory),path.join(root,directory),{recursive:true});
      engine=await RuleEngine.create(codeRoot);library=new Library(root,codeRoot,engine);
      const collection=await library.collection('bank','perf-bank'),store=new StateStore(root,engine);
      globalThis.__qfFreezeProbe=event=>{if(event.whole)samples.load.push(event.ms);};
      store.load(collection);
      globalThis.__qfFreezeProbe=event=>{if(!event.whole)samples.draft.push(event.ms);};
      for(let i=0;i<count;i++){
        const question=collection.questions[i], revision=store.load(collection).questions[question.id].revision;
        await store.act(collection,question,{requestId:`freeze-${run}-${i}`,revision,action:'draft',data:{answer:perfAnswer(i)}});
      }
    }finally{
      globalThis.__qfFreezeProbe=undefined;library?.close();await engine?.close();
      assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('qf-freeze-measure-'));fs.rmSync(root,{recursive:true,force:true});
    }
  }
  assert.equal(digest(),before);
  return {fixture,runs,node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model,seedUnchanged:true,samples,summary:Object.fromEntries(Object.entries(samples).map(([name,values])=>[name,summarizeSamples(values)]))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length!==3)throw Error('Usage: measure-state-freeze.mjs <v2-fixture-directory>');
  console.log(JSON.stringify(await measureFreeze(path.resolve(process.argv[2])),null,2));
}
