// Local synthetic diagnostic only. Does not change measure-perf's action order.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {summarizeSamples} from './measure-perf.mjs';

export async function measureCompletion(seed,{runs=3,codeRoot=fileURLToPath(new URL('../../',import.meta.url))}={}) {
  const root=path.resolve(seed), fixture=JSON.parse(fs.readFileSync(path.join(root,'perf-fixture.json'),'utf8'));
  if(fixture.fixture!=='quizforge-perf-a1-v2'||!Number.isInteger(runs)||runs<1||runs>30)throw Error('Invalid synthetic fixture or run count');
  const module=relative=>import(pathToFileURL(path.join(codeRoot,'server/host',relative)).href);
  const [{RuleEngine},{Library},{StateStore},{Timing,withTiming}]=await Promise.all([module('extensions/rule-engine.js'),module('library/library.js'),module('practice/state-store.js'),module('platform/timing.js')]);
  const hashes=()=>Object.fromEntries(fs.readdirSync(path.join(root,'.state')).filter(n=>n.endsWith('.json')).map(n=>[n,createHash('sha256').update(fs.readFileSync(path.join(root,'.state',n))).digest('hex')]));
  const before=JSON.stringify(hashes()), samples=[];
  for(let run=1;run<=runs;run++) {
    const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'qf-completion-measure-'));let engine,library;
    try {
      for(const item of ['extensions','question-banks','.state'])fs.cpSync(path.join(root,item),path.join(temporary,item),{recursive:true,errorOnExist:true,force:false});
      engine=await RuleEngine.create(codeRoot);library=new Library(temporary,codeRoot,engine);
      const collection=await library.collection('bank','perf-bank'),store=new StateStore(temporary,engine);
      store.load(collection);
      for(const operation of ['finish','restart']) {
        const summary=await store.summary(collection),request={requestId:`completion-perf-${run}-${operation}`,roundId:summary.roundId,summaryVersion:summary.summaryVersion};
        const timing=new Timing(),start=performance.now();
        await withTiming(timing,()=>store[operation](collection,request));
        const elapsed=performance.now()-start,phases=timing.values();
        if(timing.truncated)throw Error('Incomplete timing');
        samples.push({run,operation,elapsed,phases,intervals:timing.intervals.length});
      }
    } finally {
      library?.close();await engine?.close();
      if(path.dirname(temporary)!==os.tmpdir()||!path.basename(temporary).startsWith('qf-completion-measure-'))throw Error('Invalid owned diagnostic path');
      fs.rmSync(temporary,{recursive:true,force:true});
    }
  }
  if(JSON.stringify(hashes())!==before)throw Error('Seed state changed');
  const summary=Object.fromEntries(['finish','restart'].map(op=>{const rows=samples.filter(s=>s.operation===op);return [op,{elapsed:summarizeSamples(rows.map(s=>s.elapsed)),phases:Object.fromEntries(Object.keys(rows[0].phases).map(p=>[p,summarizeSamples(rows.map(s=>s.phases[p]))]))}];}));
  return {fixture:fixture.fixture,stateBytes:fixture.stateBytes,mode:'direct StateStore calls; warm collection; no HTTP or library resolution',runs,node:process.version,cpu:os.cpus()[0]?.model,samples,summary};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [seed,codeRoot]=process.argv.slice(2);if(!seed)throw Error('Usage: measure-completion-perf.mjs <v2-fixture> [core-root]');
  console.log(JSON.stringify(await measureCompletion(seed,{...(codeRoot?{codeRoot:path.resolve(codeRoot)}:{})}),null,2));
}
