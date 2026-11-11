// Same v2 open/switch/draft/whiteboard/submit sequence, plus injected TTL expiry.
// Only this isolated diagnostic process freezes the injected library clock.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {LibraryDiagnostics} from './library-diagnostic-hooks.mjs';
import {metrics} from './measure-library-perf.mjs';

const core=fileURLToPath(new URL('../../',import.meta.url)),extra=['Library.writeEnvironment','WriteEnvironment.get','WriteEnvironment.sentinels','WriteEnvironment.begin','WriteEnvironment.complete'];
const operations=['open','switch','draft','whiteboard','submit','expired-draft'];
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function worker(seed,mode,round,count){
  const fixture=JSON.parse(fs.readFileSync(path.join(seed,'perf-fixture.json'),'utf8'));assert.equal(fixture.fixture,'quizforge-perf-a1-v2');
  const before=digest(path.join(seed,fixture.stateFile)),root=fs.mkdtempSync(path.join(os.tmpdir(),'qf-sentinel-perf-')),diagnostics=mode==='diagnostic'?new LibraryDiagnostics():null;
  let service,time=0;const samples=[];
  try{
    for(const item of ['extensions','question-banks','.state'])fs.cpSync(path.join(seed,item),path.join(root,item),{recursive:true,force:false,errorOnExist:true});
    diagnostics?.install(core);
    if(diagnostics){
      const [{Library},{RuleEngine},{FileCache},{LibraryIndex},{WriteEnvironment}]=await Promise.all(['library/library.js','extensions/rule-engine.js','platform/file-cache.js','library/library-index.js','extensions/write-environment.js'].map(file=>import(pathToFileURL(path.join(core,'server/host',file)))));
      for(const name of ['readCollection','writeCollection','collection','checkedRead','load','scope','candidate','contentIdentity','contentIdentities','environment','runtimeEnvironment','writeEnvironment','indexSnapshot'])diagnostics.method(Library,name,'Library.'+name,['readCollection','writeCollection','collection'].includes(name));
      diagnostics.method(RuleEngine,'validationEnvironment');diagnostics.method(LibraryIndex,'scan');for(const name of ['entry','hash','json'])diagnostics.method(FileCache,name);for(const name of ['get','sentinels','begin','complete'])diagnostics.method(WriteEnvironment,name);
    }
    const [{QuizForgeServer},{perfAnswer,perfDraft},{parseServerTiming}]=await Promise.all([import('../../server/host/http/server.js'),import('./create-perf-fixture.mjs'),import('./measure-perf.mjs')]);
    service=await QuizForgeServer.create({root,codeRoot:core,port:0,timings:true,tailscale:{read:async()=>({state:'missing'})},hub:{fetchImpl:async()=>{throw Error('External network disabled');}}});
    service.library.now=()=>time;await service.start();await service.runtimeWarmup;
    const base=`http://127.0.0.1:${service.port()}/api/collections/bank/perf-bank`,revisions=new Map();
    const request=async(operation,uri,body)=>{
      const sample={round,mode,operation,roots:[]};if(diagnostics)diagnostics.sample=sample;
      const start=performance.now();
      try{
        const response=await fetch(base+uri,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)}),bytes=Buffer.from(await response.arrayBuffer()),data=JSON.parse(bytes);
        assert.ok(response.ok,operation+': '+response.status+' '+data.error?.code);sample.elapsed=performance.now()-start;sample.phases=parseServerTiming(response.headers.get('server-timing'));
        if(operation!=='open')samples.push(diagnostics?{round,mode,operation,elapsed:sample.elapsed,phases:sample.phases,...metrics(sample,extra)}:{round,mode,operation,elapsed:sample.elapsed,phases:sample.phases});
        return data;
      }finally{if(diagnostics)diagnostics.sample=null;}
    };
    const opened=await request('open','');for(const [id,state]of Object.entries(opened.states))revisions.set(id,state.revision);
    for(let i=0;i<count;i++)await request('switch','/questions/'+opened.questions[i].id);
    for(const operation of ['draft','whiteboard','submit'])for(let i=0;i<(operation==='submit'?Math.max(1,Math.floor(count/2)):count);i++){
      const id=opened.questions[i].id,result=await request(operation,'/questions/'+id+'/actions',{action:operation,requestId:`sentinel-${round}-${operation}-${i}`,revision:revisions.get(id),data:operation==='whiteboard'?{draft:perfDraft(120+i)}:{answer:perfAnswer(i)}});revisions.set(id,result.state.revision);
    }
    const last=opened.questions.at(-1).id;
    for(let i=0;i<10;i++){
      time+=600001;
      const result=await request('expired-draft','/questions/'+last+'/actions',{action:'draft',requestId:`sentinel-${round}-expired-${i}`,revision:revisions.get(last),data:{answer:perfAnswer(199)}});revisions.set(last,result.state.revision);
    }
    if(diagnostics){
      let cold=0,warm=0;assert.equal(new Set(diagnostics.transformed).size,5);
      for(const sample of samples){if(sample.operation==='switch')continue;assert.equal(sample.byFunction['Library.contentIdentity'].calls,2);assert.equal(sample.byFunction['Library.indexSnapshot'].calls,0);
        if(sample.operation==='expired-draft'){assert.equal(sample.byFunction['Library.environment'].calls,1);assert.equal(sample.dependency.calls,5);}
        else if(sample.byFunction['Library.environment'].calls){cold++;assert.equal(sample.operation,'draft');assert.equal(sample.dependency.calls,5);}
        else {warm++;assert.equal(sample.dependency.calls,0);assert.equal(sample.byFunction['WriteEnvironment.sentinels'].calls,1);assert.equal(sample.byFunction['WriteEnvironment.sentinels'].stats,7);}
      }
      assert.equal(cold,1);assert.equal(warm,2*count+Math.max(1,Math.floor(count/2))-1);
    }
    return {round,mode,samples,fixture,seedSha256:before};
  }finally{
    await service?.close();diagnostics?.close();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('qf-sentinel-perf-'));fs.rmSync(root,{recursive:true,force:true});assert.equal(digest(path.join(seed,fixture.stateFile)),before);
  }
}
async function child(seed,mode,round,count){return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--worker',seed,mode,String(round),String(count)],{stdio:['ignore','pipe','inherit'],windowsHide:true}),chunks=[];
  child.stdout.on('data',chunk=>chunks.push(chunk));child.once('error',reject);child.once('exit',code=>{if(code!==0)return reject(Error('Sentinel worker failed '+mode+'/'+round+': '+code));try{resolve(JSON.parse(Buffer.concat(chunks)));}catch(error){reject(error);}});
});}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv[2]==='--worker'){
    const [seed,mode,round,count]=process.argv.slice(3);console.log(JSON.stringify(await worker(path.resolve(seed),mode,Number(round),Number(count))));
  }else{
    const [seed,output,count='20',runs='3']=process.argv.slice(2);if(!seed||!output||!Number.isInteger(+count)||+count<2||+count>20||!Number.isInteger(+runs)||+runs<1||+runs>10)throw Error('Usage: measure-sentinel-perf.mjs <v2-seed> <new-output.json> [count=20] [runs=3]');if(fs.existsSync(output))throw Error('Refusing to overwrite results');
    const batches=[];for(let round=1;round<=+runs;round++)for(const mode of round%2?['plain','diagnostic']:['diagnostic','plain']){console.error(`Sentinel round ${round}/${runs} ${mode}`);batches.push(await child(path.resolve(seed),mode,round,+count));}
    const {summarizeSamples:stats}=await import('./measure-perf.mjs'),samples=batches.flatMap(batch=>batch.samples);
    const summary={};for(const mode of ['plain','diagnostic'])for(const operation of operations.filter(op=>op!=='open')){
      const selected=samples.filter(s=>s.mode===mode&&s.operation===operation);summary[mode+'/'+operation]={n:selected.length,elapsed:stats(selected.map(s=>s.elapsed)),library:stats(selected.map(s=>s.phases.library))};
      if(mode==='diagnostic')Object.assign(summary[mode+'/'+operation],{parts:Object.fromEntries(Object.keys(selected[0].parts).map(key=>[key,stats(selected.map(s=>s.parts[key]))])),functions:Object.fromEntries(Object.keys(selected[0].byFunction).map(name=>[name,Object.fromEntries(Object.keys(selected[0].byFunction[name]).map(key=>[key,stats(selected.map(s=>s.byFunction[name][key]))]))])),dependency:Object.fromEntries(Object.keys(selected[0].dependency).map(key=>[key,stats(selected.map(s=>s.dependency[key]))]))});
    }
    const result={node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model,release:os.release(),clock:'injected: canonical sequence at 0; ten expiry steps +600001 ms per run',fixture:batches[0].fixture,seedSha256:batches[0].seedSha256,summary,samples};
    fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});console.error('Sentinel measurement complete');
  }
}
