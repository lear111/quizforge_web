// Isolated B2a diagnosis. No application flags, production edits or real data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {LibraryDiagnostics,flatten,nodeMetrics,union} from './library-diagnostic-hooks.mjs';

const core=fileURLToPath(new URL('../../',import.meta.url));
const functions=['Library.readCollection','Library.checkedRead','binding.readLookup','Library.writeCollection','binding.writeLookup','Library.collection','Library.load','Library.scope','Library.candidate','Library.contentIdentity','Library.contentIdentities','Library.environment','Library.runtimeEnvironment','RuleEngine.validationEnvironment','engine.hashFile','Library.indexSnapshot','LibraryIndex.scan','files.walkEntries','files.walkFiles','extension.declaration','files.readBytes','files.readJson','files.safeFile','files.checkedStat','FileCache.entry','FileCache.hash','FileCache.json','file.sha256'];
const checksum=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let stats;
const interval=node=>[node.start,node.end];
function metrics(sample){
  const nodes=flatten(sample.roots);assert.ok(nodes.every(node=>node.end!==null),'unfinished diagnostic interval');
  const library=union(sample.roots.map(interval)),selected=names=>nodes.filter(node=>names.includes(node.name));
  const content=union(selected(['Library.contentIdentity']).map(interval)),environment=union(selected(['Library.environment']).map(interval));
  const runtime=union(selected(['Library.runtimeEnvironment','Library.environment']).map(interval))-environment;
  const index=union(selected(['Library.indexSnapshot']).map(interval)),lookup=union(selected(['binding.readLookup','binding.writeLookup']).map(interval));
  const allocated=union(selected(['Library.contentIdentity','Library.environment','Library.runtimeEnvironment','Library.indexSnapshot','binding.readLookup','binding.writeLookup']).map(interval));
  const parts={content,environment,runtime,index,lookup,otherBinding:library-allocated};
  assert.ok(Math.abs(Object.values(parts).reduce((a,b)=>a+b,0)-library)<.001,'overlapping diagnostic allocations');
  const byFunction=Object.fromEntries(functions.map(name=>[name,nodeMetrics(nodes.filter(node=>node.name===name))]));
  const dependencyNodes=nodes.filter(node=>node.name==='files.walkEntries'&&node.events.some(event=>event.file.includes(path.sep+'node_modules'+path.sep)));
  const dependency=nodeMetrics(dependencyNodes);
  const rehashed=new Set(nodes.flatMap(node=>node.events.filter(event=>event.kind==='rehash').map(event=>event.file)));
  return {roots:sample.roots.map(node=>node.name),bindingMs:library,parts,delta:sample.phases.library-library,byFunction,dependency,
    rehashed:[...rehashed].map(file=>file.startsWith(core)?path.relative(core,file).replaceAll('\\','/'):'<runtime executable>')};
}
async function worker(seed,mode,count,round){
  assert.ok(['plain','diagnostic'].includes(mode));
  const fixture=JSON.parse(fs.readFileSync(path.join(seed,'perf-fixture.json'),'utf8'));assert.equal(fixture.fixture,'quizforge-perf-a1-v2');
  const stateFile=path.join(seed,fixture.stateFile),before=checksum(stateFile),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'qf-b2a-library-'));
  const diagnostics=mode==='diagnostic'?new LibraryDiagnostics():null;let service;
  const samples=[];
  try {
    for(const item of ['extensions','question-banks','.state'])fs.cpSync(path.join(seed,item),path.join(temporary,item),{recursive:true,errorOnExist:true,force:false});
    diagnostics?.install(core);
    if(diagnostics){
      const [{Library},{RuleEngine},{FileCache},{LibraryIndex}]=await Promise.all(['library/library.js','extensions/rule-engine.js','platform/file-cache.js','library/library-index.js'].map(file=>import(pathToFileURL(path.join(core,'server/host',file)))));
      for(const name of ['readCollection','writeCollection','collection','checkedRead','load','scope','candidate','contentIdentity','contentIdentities','environment','runtimeEnvironment','indexSnapshot'])diagnostics.method(Library,name,'Library.'+name,['readCollection','writeCollection','collection'].includes(name));
      diagnostics.method(RuleEngine,'validationEnvironment');diagnostics.method(LibraryIndex,'scan');
      for(const name of ['entry','hash','json'])diagnostics.method(FileCache,name);
    }
    // These helpers import production modules, so load them only AFTER hooks.
    const [{perfAnswer},{parseServerTiming}]=await Promise.all([import('./create-perf-fixture.mjs'),import('./measure-perf.mjs')]);
    const {QuizForgeServer}=await import('../../server/host/http/server.js');
    service=await QuizForgeServer.create({root:temporary,codeRoot:core,port:0,timings:true,tailscale:{read:async()=>({state:'missing'})},hub:{fetchImpl:async()=>{throw Error('External network disabled for B2a diagnosis');}}});
    await service.start();await service.runtimeWarmup;
    const base=`http://127.0.0.1:${service.port()}/api/collections/bank/perf-bank`;
    const request=async(operation,uri,body)=>{
      const sample={round,mode,operation,roots:[]};if(diagnostics)diagnostics.sample=sample;
      const start=performance.now();
      try {
        const response=await fetch(base+uri,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});
        const bytes=Buffer.from(await response.arrayBuffer()),data=JSON.parse(bytes);assert.ok(response.ok,operation+': '+response.status+' '+data.error?.code);
        sample.elapsed=performance.now()-start;sample.phases=parseServerTiming(response.headers.get('server-timing'));
        if(operation!=='open')samples.push(diagnostics?{round,mode,operation,elapsed:sample.elapsed,phases:sample.phases,...metrics(sample)}:{round,mode,operation,elapsed:sample.elapsed,phases:sample.phases});
        return data;
      }finally{if(diagnostics)diagnostics.sample=null;}
    };
    const opened=await request('open','');
    for(let i=0;i<count;i++)await request('switch','/questions/'+opened.questions[i].id);
    for(let i=0;i<count;i++){const id=opened.questions[i].id;await request('draft','/questions/'+id+'/actions',{action:'draft',requestId:`b2a-${round}-${mode}-${i}`,revision:opened.states[id].revision,data:{answer:perfAnswer(i)}});}
    if(diagnostics){assert.equal(new Set(diagnostics.transformed).size,5);for(const sample of samples){assert.equal(sample.byFunction['Library.indexSnapshot'].calls,0,'warm sample unexpectedly entered full loader');assert.equal(sample.byFunction['Library.contentIdentity'].calls,sample.operation==='draft'?2:1);assert.equal(sample.byFunction['Library.environment'].calls,sample.operation==='draft'?1:0,'runtime TTL expired; sample is not the intended warm case');}}
    return {round,mode,samples,transformed:diagnostics?.transformed??[],fixture,seedSha256:before};
  }finally{
    await service?.close();diagnostics?.close();assert.equal(path.dirname(temporary),os.tmpdir());assert.ok(path.basename(temporary).startsWith('qf-b2a-library-'));fs.rmSync(temporary,{recursive:true,force:true});assert.equal(checksum(stateFile),before,'seed state changed');
  }
}
function summarize(rows){
  const result={};
  for(const mode of ['plain','diagnostic'])for(const operation of ['switch','draft']){
    const samples=rows.filter(row=>row.mode===mode&&row.operation===operation),label=mode+'/'+operation;
    result[label]={n:samples.length,elapsed:stats(samples.map(row=>row.elapsed)),library:stats(samples.map(row=>row.phases.library))};
    if(mode==='diagnostic'){
      Object.assign(result[label],{bindingMs:stats(samples.map(row=>row.bindingMs)),delta:stats(samples.map(row=>row.delta)),parts:Object.fromEntries(Object.keys(samples[0].parts).map(key=>[key,stats(samples.map(row=>row.parts[key]))])),
        functions:Object.fromEntries(functions.map(name=>[name,Object.fromEntries(Object.keys(samples[0].byFunction[name]).map(key=>[key,stats(samples.map(row=>row.byFunction[name][key]))]))])),
        dependency:Object.fromEntries(Object.keys(samples[0].dependency).map(key=>[key,stats(samples.map(row=>row.dependency[key]))])),rehashed:[...new Set(samples.flatMap(row=>row.rehashed))]});
    }
  }
  return result;
}
async function child(seed,mode,count,round){
  return new Promise((resolve,reject)=>{
    const childProcess=spawn(process.execPath,[fileURLToPath(import.meta.url),'--worker',seed,mode,String(count),String(round)],{stdio:['ignore','pipe','inherit'],windowsHide:true});const chunks=[];
    childProcess.stdout.on('data',chunk=>chunks.push(chunk));childProcess.once('error',reject);childProcess.once('exit',code=>{if(code!==0)return reject(Error('Diagnostic worker failed: '+mode+'/'+round+' exit '+code));try{resolve(JSON.parse(Buffer.concat(chunks)));}catch(error){reject(error);}});
  });
}
if(process.argv[2]==='--worker'){
  const [,seed,mode,count,round]=process.argv.slice(2);console.log(JSON.stringify(await worker(path.resolve(seed),mode,Number(count),Number(round))));
}else if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [seed,output,count='20',runs='3']=process.argv.slice(2);
  if(!seed||!output||!Number.isInteger(+count)||+count<1||+count>20||!Number.isInteger(+runs)||+runs<1||+runs>10)throw Error('Usage: measure-library-perf.mjs <v2-seed> <new-output.json> [samples-per-run=20] [runs=3]');
  if(fs.existsSync(output))throw Error('Refusing to overwrite diagnostic results');
  const batches=[];
  for(let round=1;round<=+runs;round++)for(const mode of round%2?['plain','diagnostic']:['diagnostic','plain']){console.error(`B2a round ${round}/${runs} ${mode}`);batches.push(await child(path.resolve(seed),mode,+count,round));}
  ({summarizeSamples:stats}=await import('./measure-perf.mjs'));
  const samples=batches.flatMap(batch=>batch.samples),result={node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model,release:os.release(),fixture:batches[0].fixture,seedSha256:batches[0].seedSha256,transformed:batches.find(batch=>batch.mode==='diagnostic').transformed,summary:summarize(samples),samples};
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});console.error('B2a diagnostics complete');
}
