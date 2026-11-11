import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WriteEnvironment,WRITE_ENVIRONMENT_REUSE_MS} from './write-environment.js';
import {RuleEngine,RULE_DEPENDENCIES} from './rule-engine.js';
import {Library} from '../library/library.js';
import {copyFixture} from '../../../test/fixtures/installed-library.mjs';
import {jsonBytes} from '../platform/json.js';

const actualCore=fileURLToPath(new URL('../../../',import.meta.url));
const dependencies=['ajv','fast-uri','fast-deep-equal','json-schema-traverse','require-from-string'];
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qf-write-environment-')),core=path.join(root,'core'),node=path.join(root,'node.bin');
  const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  write(node,'synthetic Node bytes');write(path.join(core,'server/rules-runner.cjs'),'// synthetic runner');
  for(const name of dependencies){write(path.join(core,'node_modules',name,'package.json'),JSON.stringify({name,version:'1.0.0'}));write(path.join(core,'node_modules',name,'index.js'),'// synthetic dependency');}
  const engine=new RuleEngine(core,{node});engine.nodeExecutable=node;engine.nodeMetadata='synthetic-node-metadata';let calls=0,time=0;
  const validation=RuleEngine.prototype.validationEnvironment.bind(engine);engine.validationEnvironment=()=>{calls++;return validation();};
  const cache=new WriteEnvironment(core,{nodePath:()=>node,now:()=>time});
  const full=async()=>{const ticket=cache.begin(),value=await engine.validationEnvironment();cache.complete(ticket,value);return value;};
  t.after(async()=>{await engine.close();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('qf-write-environment-'));fs.rmSync(root,{recursive:true,force:true});});
  return {root,core,node,engine,cache,full,get:()=>cache.get(full),calls:()=>calls,time:value=>{time=value;},now:()=>time};
}
async function libraryFixture(t){
  const env=fixture(t),root=path.join(env.root,'data'),directory=path.join(root,'extensions/Test/choice');
  copyFixture(path.join(actualCore,'test/fixtures/legacy-extensions/single-choice-1.0.0'),directory,{recursive:true});
  const bank=JSON.parse(fs.readFileSync(path.join(directory,'examples.json'),'utf8'));bank.id='sentinel-bank';
  fs.mkdirSync(path.join(root,'question-banks/Group/Bank'),{recursive:true});fs.writeFileSync(path.join(root,'question-banks/Group/Bank/bank.json'),jsonBytes(bank));
  const engine=await RuleEngine.create(actualCore);engine.validationEnvironment=()=>env.engine.validationEnvironment();
  const library=new Library(root,actualCore,engine);library.now=env.now;library.writeRuntime=env.cache;
  t.after(async()=>{library.close();await engine.close();});
  const opened=await library.collection('extension','quizforge.single-choice');await library.writeCollection('extension','quizforge.single-choice');
  return {...env,library,opened};
}

test('sentinels use the seven required checked file identities and the host Node path by default',t=>{
  const f=fixture(t),cache=new WriteEnvironment(f.core),values=cache.sentinels();
  assert.equal(values.length,7);assert.ok(values[0].startsWith(path.resolve(process.execPath)+'\0'));
  assert.ok(values[1].startsWith(path.join(f.core,'server','rules-runner.cjs')+'\0'));
  for(let i=0;i<dependencies.length;i++)assert.ok(values[i+2].startsWith(path.join(f.core,'node_modules',dependencies[i],'package.json')+'\0'));
});

test('sentinel dependencies equal the actual validation traversal and preserve the baseline fingerprint',async t=>{
  const f=fixture(t),traversed=new Set(),read=fs.readdirSync,base=path.join(f.core,'node_modules');
  fs.readdirSync=function(directory,...args){const absolute=path.resolve(String(directory));if(path.dirname(absolute)===base)traversed.add(path.basename(absolute));return read.call(this,directory,...args);};
  let value;try{value=await f.engine.validationEnvironment();}finally{fs.readdirSync=read;}
  const sentinels=new Set(f.cache.sentinels().slice(2).map(entry=>path.basename(path.dirname(entry.split('\0')[0]))));
  assert.deepEqual(sentinels,traversed);assert.deepEqual(traversed,new Set(RULE_DEPENDENCIES));
  assert.ok(Object.isFrozen(RULE_DEPENDENCIES));assert.deepEqual([...RULE_DEPENDENCIES],dependencies,'original traversal order is part of the fingerprint');
  // Captured from unmodified c5a9166, using this same synthetic install. No host paths enter the hashed list.
  assert.equal(value,'80458ae0167cdd00b42fe5f26620bdbae703c1e9493caa42c938c893634b07da');
});

for(const kind of ['node','runner','package'])test('the next library write immediately observes changed '+kind+' sentinel identity',async t=>{
  const f=await libraryFixture(t),before=f.calls(),files={node:f.node,runner:path.join(f.core,'server/rules-runner.cjs'),package:path.join(f.core,'node_modules/ajv/package.json')};
  const prior=f.library.loaded.get('extension:quizforge.single-choice').environment;fs.appendFileSync(files[kind],' ');
  const updated=await f.library.writeCollection('extension','quizforge.single-choice');
  assert.notEqual(updated,f.opened);assert.ok(f.calls()>before);
  const next=f.library.loaded.get('extension:quizforge.single-choice').environment;assert.notEqual(next,prior);assert.equal(next,await RuleEngine.prototype.validationEnvironment.call(f.engine));
});

for(const elapsed of [599999,600000,600001])test('non-sentinel edits at '+elapsed+' ms obey the exact ten-minute write window',async t=>{
  const f=await libraryFixture(t),before=f.calls(),prior=f.library.loaded.get('extension:quizforge.single-choice').environment;
  fs.appendFileSync(path.join(f.core,'node_modules/ajv/index.js'),'\n// changed without changing package.json');f.time(elapsed);
  const result=await f.library.writeCollection('extension','quizforge.single-choice'),changed=elapsed>WRITE_ENVIRONMENT_REUSE_MS;
  assert.equal(result!==f.opened,changed);assert.equal(f.calls()>before,changed);
  assert.equal(f.library.loaded.get('extension:quizforge.single-choice').environment===prior,!changed);
});

test('a read still refreshes at thirty seconds and warm writes do not extend that read TTL',async t=>{
  const f=await libraryFixture(t),before=f.calls();fs.appendFileSync(path.join(f.core,'node_modules/ajv/index.js'),'\n// non-sentinel edit');
  f.time(29000);assert.equal(await f.library.writeCollection('extension','quizforge.single-choice'),f.opened);assert.equal(f.calls(),before);assert.equal(f.library.recentEnvironment.at,0);
  f.time(30000);assert.notEqual(await f.library.readCollection('extension','quizforge.single-choice'),f.opened);assert.ok(f.calls()>before);
});

for(const trigger of ['invalidate','cold-load'])test(trigger+' makes the first subsequent write compute the full environment',async t=>{
  const f=await libraryFixture(t);
  if(trigger==='invalidate')f.library.invalidate();else{f.library.loaded.clear();await f.library.collection('extension','quizforge.single-choice');}
  const before=f.calls();await f.library.writeCollection('extension','quizforge.single-choice');assert.ok(f.calls()>before);
});

test('a real archive import discards the successful write cache before the first subsequent write',async t=>{
  const f=await libraryFixture(t),download=await f.library.exportGroup('Group');let bytes;
  try{bytes=fs.readFileSync(download.file);}finally{download.close();}
  const imported=await f.library.importPackage(bytes);assert.equal(imported.importedBanks,1);assert.equal(f.cache.cached,null);assert.equal(f.cache.fullWriteRequired,true);
  const before=f.calls();await f.library.writeCollection('extension','quizforge.single-choice');assert.ok(f.calls()>before);
});

test('unavailable results are never reused and recovery preserves the original fingerprint',async t=>{
  const f=fixture(t),original=await f.get(),file=path.join(f.core,'node_modules/ajv/package.json'),bytes=fs.readFileSync(file);
  fs.unlinkSync(file); // Missing sentinel forces full checks; make the full walk unavailable as well.
  fs.renameSync(path.join(f.core,'node_modules/fast-uri'),path.join(f.core,'node_modules/fast-uri-away'));
  assert.equal(await f.get(),'unavailable');const before=f.calls();assert.equal(await f.get(),'unavailable');assert.equal(f.calls(),before+1);assert.equal(f.cache.cached,null);
  fs.writeFileSync(file,bytes);fs.renameSync(path.join(f.core,'node_modules/fast-uri-away'),path.join(f.core,'node_modules/fast-uri'));
  assert.equal(await f.get(),original);const recovered=f.calls();assert.equal(await f.get(),original);assert.equal(f.calls(),recovered);
});

test('a missing sentinel is never turned into a successful reusable guard',async t=>{
  const f=fixture(t);await f.get();fs.unlinkSync(path.join(f.core,'node_modules/ajv/package.json'));
  await f.get();assert.equal(f.cache.cached,null);const before=f.calls();await f.get();assert.equal(f.calls(),before+1);
});

test('redirected sentinel parents keep the existing checked-path rejection',async t=>{
  const f=fixture(t);await f.get();const original=path.join(f.core,'node_modules/ajv'),moved=path.join(f.root,'redirected-ajv');fs.renameSync(original,moved);
  fs.symlinkSync(moved,original,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>f.cache.sentinels());assert.equal(await f.get(),'unavailable');assert.equal(f.cache.cached,null);
});

test('a sentinel change during a full calculation cannot seed the next write cache',async t=>{
  const f=fixture(t),ticket=f.cache.begin(),value=await f.engine.validationEnvironment();fs.appendFileSync(path.join(f.core,'node_modules/ajv/package.json'),' ');f.cache.complete(ticket,value);
  assert.equal(f.cache.cached,null);assert.notEqual(await f.get(),value);
});

test('invalidate during a pending full calculation cannot republish its cache',async t=>{
  const f=fixture(t),gate=Promise.withResolvers();
  const pending=f.cache.get(async()=>{const ticket=f.cache.begin();await gate.promise;const value=await f.engine.validationEnvironment();f.cache.complete(ticket,value);return value;});
  f.cache.clear();gate.resolve();await pending;assert.equal(f.cache.cached,null);assert.equal(f.cache.fullWriteRequired,true);
  const before=f.calls();await f.get();assert.equal(f.calls(),before+1);
});

test('clock rollback and a forced first write cannot silently extend a successful cache',async t=>{
  const f=fixture(t),value=await f.get();f.time(-1);const before=f.calls();assert.equal(await f.get(),value);assert.equal(f.calls(),before+1);
  f.cache.requireFullWrite();const forced=f.calls();assert.equal(await f.get(),value);assert.equal(f.calls(),forced+1);
});

test('replacing a sentinel with identical bytes recomputes but keeps the exact fingerprint',async t=>{
  const f=fixture(t),value=await f.get(),copy=path.join(f.root,'replacement.bin');fs.writeFileSync(copy,fs.readFileSync(f.node));fs.renameSync(copy,f.node);
  const before=f.calls();assert.equal(await f.get(),value);assert.equal(f.calls(),before+1);
});

test('successful validation cache keys and stored checks survive a cold reload',async t=>{
  const f=await libraryFixture(t),key=f.library.loaded.get('extension:quizforge.single-choice').cacheKey;
  assert.match(key,/^[a-f0-9]{64}$/);const file=path.join(f.library.validationCache.directory,key+'.json'),bytes=fs.readFileSync(file);
  let validations=0;const run=f.library.engine.run.bind(f.library.engine);f.library.engine.run=(extension,input)=>{if(['validateBank','outlineBatch'].includes(input.op))validations++;return run(extension,input);};
  f.library.invalidate();await f.library.collection('extension','quizforge.single-choice');
  assert.equal(f.library.loaded.get('extension:quizforge.single-choice').cacheKey,key);assert.equal(validations,0);assert.ok(fs.readFileSync(file).equals(bytes));
});
