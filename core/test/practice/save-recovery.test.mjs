import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindSaveRecovery} from '../../web/practice/save-recovery.js';
import {createDraftBuffer,createWriteQueue} from '../../web/shared/write-queue.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function fixture(t,{readError,mountError,persistent=true,confirmed=true}={}){
  const dom=new JSDOM('<section></section><div id="save-recovery"></div>',{runScripts:'outside-only'});loadVueUi(dom);
  t.after(()=>dom.window.close());
  const calls=[],ink=createDraftBuffer();ink.replace({strokes:['unsaved']});
  const plugin={flush:async()=>{calls.push('flush');throw new Error('尚未保存的输入无法提交');},setActive:value=>calls.push(['active',value]),destroy:()=>calls.push('destroy')};
  const pane={node:dom.window.document.querySelector('section'),questionId:'q1',plugin,ink,inkTimer:7,whiteboard:{flush:()=>calls.push('whiteboard-flush')},writes:createWriteQueue({send:async()=>{throw Object.assign(new Error('题目已更改'),{code:'CONTENT_CONFLICT'});},revisionFor:()=>0,makeRequestId:()=> 'failed'})};
  await assert.rejects(pane.writes.enqueue('q1','draft',{answer:'local'},{contentVersion:'old'}));
  const payload={question:{id:'q1'},state:{answer:'server'}};
  const options={document:dom.window.document,active:()=>pane,transitionTo:async fn=>{try{return await fn();}finally{pane.node.inert=false;}},confirm:()=>confirmed,cancel:id=>calls.push(['cancel',id]),loadQuestion:async(target,qid,flags)=>{calls.push(['read',qid,flags.fresh]);assert.equal(target,pane);assert.equal(pane.recovering,true);if(readError)throw readError;return payload;},showQuestion:async(target,qid,value)=>{calls.push(['mount',qid]);assert.equal(target,pane);assert.equal(value.payload,payload);if(mountError)throw mountError;plugin.destroy();pane.plugin={};},saveInk:async()=>calls.push('save-ink'),notice:message=>calls.push(['notice',message]),collectionFeature:()=>persistent};
  const recovery=bindSaveRecovery(options);t.after(()=>recovery.destroy());
  return {recovery,pane,plugin,calls,options,dom};
}

test('explicit server reload discards failing flush input only after a fresh replacement succeeds',async t=>{
  const f=await fixture(t);await f.recovery.loadSaved();
  assert.equal(f.calls.includes('flush'),false);
  assert.deepEqual(f.calls.slice(0,4),[['cancel',7],['active',false],['read','q1',true],['mount','q1']]);
  assert.equal(f.calls.includes('destroy'),true);assert.equal(f.pane.ink.pending,false);assert.equal(f.pane.writes.hasFailures,false);
  assert.equal(f.pane.recovering,false);assert.equal(f.pane.node.inert,false);assert.equal(f.pane.inkTimer,null);
});

test('a failed server read keeps the original frame, answer failure and whiteboard input',async t=>{
  const f=await fixture(t,{readError:new Error('offline')});await assert.rejects(f.recovery.loadSaved(),/offline/);
  assert.equal(f.pane.plugin,f.plugin);assert.equal(f.calls.includes('destroy'),false);assert.equal(f.calls.includes('flush'),false);
  assert.equal(f.pane.ink.pending,true);assert.equal(f.pane.writes.failures[0].data.answer,'local');
  assert.deepEqual(f.calls.at(-1),['active',true]);assert.equal(f.pane.recovering,false);assert.equal(f.pane.node.inert,false);
});

test('a rejected replacement keeps failed input available for another recovery attempt',async t=>{
  const f=await fixture(t,{mountError:new Error('registration failed')});await assert.rejects(f.recovery.loadSaved(),/registration failed/);
  assert.equal(f.pane.plugin,f.plugin);assert.equal(f.pane.ink.pending,true);assert.equal(f.pane.writes.hasFailures,true);
  assert.deepEqual(f.calls.at(-1),['active',true]);assert.equal(f.pane.recovering,false);
});

test('server reload waits for an accepted write before requesting its resulting state',async t=>{
  const f=await fixture(t);let settle;
  f.pane.writes.settled=()=>new Promise(resolve=>{settle=resolve;});
  const loading=f.recovery.loadSaved();await tick();assert.equal(f.calls.some(call=>call[0]==='read'),false);
  settle();await loading;assert.equal(f.calls.some(call=>call[0]==='read'),true);
});

test('canceling recovery does not pause or change any local input',async t=>{
  const f=await fixture(t,{confirmed:false});await f.recovery.loadSaved();
  assert.deepEqual(f.calls,[]);assert.equal(f.pane.plugin,f.plugin);assert.equal(f.pane.ink.pending,true);assert.equal(f.pane.writes.hasFailures,true);
});

test('a closed pane during the read cannot remount or clear its failed input',async t=>{
  const f=await fixture(t);let complete;
  f.options.loadQuestion=()=>new Promise(resolve=>{complete=resolve;});
  f.recovery.destroy();const recovery=bindSaveRecovery(f.options);t.after(()=>recovery.destroy());
  const loading=recovery.loadSaved();await tick();f.pane.closed=true;complete({});await loading;
  assert.equal(f.calls.some(call=>call[0]==='mount'),false);assert.equal(f.pane.ink.pending,true);assert.equal(f.pane.writes.hasFailures,true);
  assert.equal(f.pane.recovering,false);assert.deepEqual(f.calls.at(-1),['active',false]);
});

test('retry replays preserved failures with their original content version',async t=>{
  const f=await fixture(t);f.plugin.flush=async()=>{};
  const sent=[];f.pane.writes.enqueue=async(...args)=>{sent.push(args);f.pane.writes.clear();};
  await f.recovery.retry();assert.deepEqual(sent,[['q1','draft',{answer:'local'},{contentVersion:'old'}]]);
  assert.equal(f.calls.includes('save-ink'),true);assert.equal(f.pane.node.inert,false);
});

test('session-only recovery reports the current browser session',async t=>{
  const f=await fixture(t,{persistent:false});await f.recovery.loadSaved();assert.deepEqual(f.calls.at(-1),['notice','已读取当前会话状态。']);
});

test('Vue recovery controls render conflict feedback and lock duplicate requests immediately',async t=>{
  const f=await fixture(t);let release;f.plugin.flush=()=>new Promise(resolve=>{release=resolve;});
  const document=f.dom.window.document,button=document.querySelector('#retry-save');assert.match(document.querySelector('#recovery-message').textContent,/题目内容已更改/);
  button.click();button.click();assert.equal(button.disabled,true);assert.equal(document.querySelector('#load-saved').disabled,true);
  release();await tick();assert.equal(button.disabled,false);assert.equal(f.calls.filter(value=>value==='save-ink').length,1);
});

for(const change of ['pane','question','dispose'])test('a queued recovery cannot change a different context: '+change,async t=>{
  const f=await fixture(t);let queued,active=f.pane;f.options.active=()=>active;f.options.transitionTo=fn=>new Promise(resolve=>{queued=async()=>{await fn();resolve();};});f.recovery.destroy();
  const recovery=bindSaveRecovery(f.options);t.after(()=>recovery.destroy());const pending=recovery.loadSaved();
  if(change==='pane')active=null;else if(change==='question')f.pane.questionId='q2';else recovery.destroy();
  await queued();await pending;assert.equal(f.calls.some(value=>value[0]==='read'),false);assert.equal(f.pane.ink.pending,true);assert.equal(f.pane.writes.hasFailures,true);
});

for(const change of ['question','dispose'])test('late recovery reads preserve failed input after '+change,async t=>{
  const f=await fixture(t);let release;f.options.loadQuestion=()=>new Promise(resolve=>{release=resolve;});f.recovery.destroy();
  const recovery=bindSaveRecovery(f.options);t.after(()=>recovery.destroy());const pending=recovery.loadSaved();await tick();
  if(change==='question')f.pane.questionId='q2';else recovery.destroy();release({});await pending;
  assert.equal(f.calls.some(value=>value[0]==='mount'),false);assert.equal(f.pane.ink.pending,true);assert.equal(f.pane.writes.hasFailures,true);
});
