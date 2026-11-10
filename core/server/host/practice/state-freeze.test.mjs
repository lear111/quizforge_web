import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {StateStore} from './state-store.js';
import {cloneJson, jsonBytes} from '../platform/json.js';
import {BankFeatures} from '../library/features.js';

for(const memory of [false,true])test(`load and commit freeze every new level; failed commit retains old root and bytes (${memory?'memory':'disk'})`,t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qf-freeze-'));
  t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('qf-freeze-'));fs.rmSync(root,{recursive:true,force:true});});
  const collection={stateKey:()=> 'bank:freeze-test',extensionFingerprint:'a'.repeat(64),features:new BankFeatures(),questions:[]};
  const store=new StateStore(root,null,{memoryOnly:memory}), fresh=store.load(collection);
  assert.ok(Object.isFrozen(fresh));assert.ok(Object.isFrozen(fresh.questions));assert.throws(()=>{fresh.questions.changed={};},TypeError);
  const next=cloneJson(fresh);next.questions.q1={status:'draft',revision:1,fingerprint:'b'.repeat(64),answer:{values:[1,2]},result:null,draft:null,receipts:[]};store.commit(collection,next);
  assert.equal(store.load(collection),next);assert.ok(Object.isFrozen(next.questions.q1.answer.values));
  if(!memory){const cold=new StateStore(root,null).load(collection);assert.ok(Object.isFrozen(cold.questions.q1.answer.values));}
  const oldBytes=jsonBytes(next), candidate=cloneJson(next);candidate.questions.q1.answer.values.push(3);
  if(memory) store.cachedBytes=32*1024*1024;
  else {
    const rename=fs.renameSync;
    fs.renameSync=(from,to)=>{if(to===store.file(collection))throw Object.assign(new Error('synthetic failure'),{code:'EIO'});return rename(from,to);};
    t.after(()=>{fs.renameSync=rename;});
  }
  const bytes=store.cachedBytes;
  assert.throws(()=>store.commit(collection,candidate),error=>error.code===(memory?'PRACTICE_SESSION_LIMIT':'STATE_WRITE_FAILED'));
  assert.equal(store.load(collection),next);assert.equal(store.cachedBytes,bytes);assert.ok(jsonBytes(next).equals(oldBytes));
  if(!memory)assert.ok(fs.readFileSync(store.file(collection)).equals(oldBytes));
});
