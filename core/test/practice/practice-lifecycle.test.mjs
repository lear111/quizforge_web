import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindPracticeLifecycle} from '../../web/practice/practice-lifecycle.js';
import {createWriteQueue} from '../../web/shared/write-queue.js';
import {shouldWarnBeforeUnload,renderEditorStatus} from '../../web/editor/editor-navigation.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
  const dom=new JSDOM(readFileSync(new URL('../../web/index.html',import.meta.url),'utf8'),{runScripts:'outside-only'});loadVueUi(dom);
  const panes=[{node:{inert:false}}],events=[],errors=[],document=dom.window.document;
  const config={document,panes:()=>panes,notice:value=>events.push(['notice',value]),failure:error=>errors.push(error),updateChrome(){events.push(['chrome']);document.getElementById('previous').disabled=false;document.getElementById('next').disabled=false;},renderRecovery:()=>events.push(['recovery'])};
  let lifecycle;const bind=()=>lifecycle=bindPracticeLifecycle(config);bind();t.after(()=>{lifecycle.destroy();dom.window.close();});
  return {dom,document,panes,events,errors,config,bind,get lifecycle(){return lifecycle;}};
}

test('transitions stay FIFO, disable controls at execution and restore the host after each operation',async t=>{
  const f=fixture(t),gate=deferred(),seen=[];
  const first=f.lifecycle.transition(async()=>{seen.push('one');f.panes[0].node.inert=true;assert.equal(f.document.getElementById('next').disabled,true);await gate.promise;return 42;});
  const second=f.lifecycle.transition(()=>{seen.push('two');assert.equal(f.panes[0].node.inert,false);return 'done';});
  await tick();assert.deepEqual(seen,['one']);gate.resolve();assert.equal(await first,42);assert.equal(await second,'done');await f.lifecycle.settled();
  assert.deepEqual(seen,['one','two']);assert.equal(f.document.getElementById('previous').disabled,false);assert.equal(f.events.filter(row=>row[0]==='chrome').length,2);
});

test('rejection remains visible to callers, is reported once, and cannot poison the next transition',async t=>{
  const f=fixture(t),error=new Error('保存失败');
  await assert.rejects(f.lifecycle.transition(()=>{f.panes[0].node.inert=true;throw error;}),value=>value===error);
  await f.lifecycle.settled();assert.deepEqual(f.errors,[error]);assert.equal(f.panes[0].node.inert,false);
  assert.equal(await f.lifecycle.transition(()=>7),7);assert.equal(f.events.filter(row=>row[0]==='recovery').length,2);
});

test('write ownership is idempotent and overlapping manual writes release only their own tokens',t=>{
  const f=fixture(t),a={},b={};f.lifecycle.setWriteBusy(a,true);f.lifecycle.setWriteBusy(a,true);f.lifecycle.setWriteBusy(b,true);
  const end=f.lifecycle.beginWrite(),endOther=f.lifecycle.beginWrite();assert.equal(f.lifecycle.pendingWrites,4);
  end();end();f.lifecycle.setWriteBusy(a,false);f.lifecycle.setWriteBusy(a,false);assert.equal(f.lifecycle.pendingWrites,2);
  endOther();f.lifecycle.setWriteBusy(b,false);assert.equal(f.lifecycle.pendingWrites,0);
});

test('before-unload protection sees every active write without treating successful releases as unsaved work',t=>{
  const f=fixture(t),end=f.lifecycle.beginWrite(),owner={};f.lifecycle.setWriteBusy(owner,true);
  assert.equal(shouldWarnBeforeUnload([],f.lifecycle.pendingWrites),true);end();assert.equal(shouldWarnBeforeUnload([],f.lifecycle.pendingWrites),true);
  f.lifecycle.setWriteBusy(owner,false);assert.equal(shouldWarnBeforeUnload([],f.lifecycle.pendingWrites),false);
  assert.equal(shouldWarnBeforeUnload([{ink:{pending:true}}],f.lifecycle.pendingWrites),true);
});

test('status stays pure text, retains the existing classes and has an immutable snapshot',t=>{
  const f=fixture(t);f.lifecycle.setSaveStatus('<img src=x onerror=alert(1)>','error');const saved=f.lifecycle.saveStatus;
  assert.equal(f.document.querySelector('#save-state img'),null);assert.equal(f.document.getElementById('save-state').textContent,saved.text);assert.equal(Object.isFrozen(saved),true);
  assert.equal(f.document.getElementById('save-state').className,'save-state error');f.lifecycle.setSaveStatus('已保存');assert.equal(saved.type,'error');assert.equal(f.lifecycle.saveStatus.type,'');
});

test('editor dirty status uses the shared status writer without replacing a saving or failed message',t=>{
  const f=fixture(t),pane={view:'edit',loading:false,editorSession:{isDirty:true}},write=(...args)=>f.lifecycle.setSaveStatus(...args);
  renderEditorStatus(f.document,pane,write);assert.equal(f.lifecycle.saveStatus.text,'本题修改未保存');
  for(const type of ['saving','error']){f.lifecycle.setSaveStatus('保留',type);renderEditorStatus(f.document,pane,write);assert.equal(f.lifecycle.saveStatus.text,'保留');}
  f.lifecycle.setSaveStatus('');pane.editorSession.isDirty=false;renderEditorStatus(f.document,pane,write);assert.equal(f.lifecycle.saveStatus.text,'本题未修改');
});

test('disposal drops queued work and UI callbacks but does not cancel a running write or fake its completion',async t=>{
  const f=fixture(t),gate=deferred();let end,calls=0;
  const running=f.lifecycle.transition(async()=>{end=f.lifecycle.beginWrite();await gate.promise;end();return 'accepted';});
  const queued=f.lifecycle.transition(()=>{calls++;});await tick();const before=f.events.length;
  f.lifecycle.destroy();f.lifecycle.destroy();assert.equal(f.lifecycle.pendingWrites,1);f.lifecycle.setSaveStatus('late');
  gate.resolve();assert.equal(await running,'accepted');assert.equal(await queued,undefined);assert.equal(await f.lifecycle.transition(()=>{calls++;}),undefined);
  assert.equal(calls,0);assert.equal(f.lifecycle.pendingWrites,0);assert.equal(f.events.length,before);assert.equal(f.document.getElementById('save-state').textContent,'');
});

test('late failure after disposal still rejects the caller without reporting into a new page',async t=>{
  const f=fixture(t),gate=deferred(),error=new Error('late');const run=f.lifecycle.transition(()=>gate.promise);await tick();f.lifecycle.destroy();
  gate.reject(error);await assert.rejects(run,value=>value===error);await f.lifecycle.settled();assert.deepEqual(f.errors,[]);
});

test('rebinding prevents old status and queued transitions from modifying the new binding',async t=>{
  const f=fixture(t),gate=deferred(),old=f.lifecycle;const running=old.transition(()=>gate.promise);old.transition(()=>{throw new Error('must be dropped');});await tick();f.bind();
  f.lifecycle.setSaveStatus('new');old.setSaveStatus('old');old.destroy();gate.resolve();await running;await old.settled();
  assert.equal(f.document.getElementById('save-state').textContent,'new');assert.deepEqual(f.errors,[]);await f.lifecycle.transition(()=>{});
});

test('real host write-queue busy callbacks release after success and failure, preserving failed input for retry',async t=>{
  const f=fixture(t),gate=deferred(),pane={kind:'bank',id:'demo',key:'bank:demo',questionId:'q',collection:{states:{q:{revision:0}}}},saved=[],failure=new Error('network');let broken=true;
  const source=readFileSync(new URL('../../web/app.js',import.meta.url),'utf8');
  const sandbox={createWriteQueue,practiceLifecycle:f.lifecycle,makeRequestId:()=> 'r',stateFor:()=>({revision:0}),questionPath:()=>'/q',request:async()=>{await gate.promise;if(broken)throw failure;return {state:{revision:1}};},active:()=>null,questionsCache:{set:(_key,value)=>saved.push(value)},questionCacheKey:()=> 'q'};
  vm.runInNewContext(source.slice(source.indexOf('function makeWriteQueue('),source.indexOf('\nasync function mutate('))+'\nglobalThis.make=makeWriteQueue;',sandbox);pane.writes=sandbox.make(pane);
  const first=pane.writes.enqueue('q','draft',{answer:'kept'});await tick();assert.equal(f.lifecycle.pendingWrites,1);gate.resolve();await assert.rejects(first,value=>value===failure);assert.equal(f.lifecycle.pendingWrites,0);assert.equal(pane.writes.hasFailures,true);
  broken=false;await pane.writes.enqueue('q','draft',{answer:'retry'});assert.equal(f.lifecycle.pendingWrites,0);assert.equal(pane.writes.hasFailures,false);assert.equal(saved.length,1);
});

test('pagehide keeps BFCache state and disposes the coordinator only on actual departure',t=>{
  const f=fixture(t),source=readFileSync(new URL('../../web/app.js',import.meta.url),'utf8');let otherDestroyed=0;
  const disposable={destroy(){otherDestroyed++;}},sandbox={window:f.dom.window,practiceLifecycle:f.lifecycle,refreshCatalog:{client:{stop(){}}},questionStepper:disposable,historyManager:disposable,editorUi:disposable,examControls:disposable,workspaceChrome:disposable,saveRecovery:disposable,collectionLoading:disposable,destroyLibraryView(){},destroyOutlineView(){},document:f.document,libraryManager:disposable,appearanceSettings:disposable,networkSettings:disposable,aiSettings:disposable,userCenter:disposable,developmentSettings:disposable};
  const start=source.indexOf("window.addEventListener('pagehide',event=>");vm.runInNewContext(source.slice(start,source.indexOf('\ndocument.addEventListener',start)),sandbox);
  f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pagehide',{persisted:true}));f.lifecycle.setSaveStatus('retained');assert.equal(otherDestroyed,0);
  f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pagehide',{persisted:false}));f.lifecycle.setSaveStatus('late');assert.equal(f.document.getElementById('save-state').textContent,'retained');assert.equal(otherDestroyed,13);
});

for(const fail of [false,true])test('finishing practice holds unload protection until the real host operation settles: '+fail,async t=>{
  const f=fixture(t),gate=deferred(),pane={kind:'bank',id:'demo',key:'bank:demo',node:f.panes[0].node},summary={summaryVersion:'v1',roundId:'round',answeredUnsubmittedCount:0},error=new Error('finish failed');
  const source=readFileSync(new URL('../../web/app.js',import.meta.url),'utf8'),sandbox={practiceLifecycle:f.lifecycle,transitionTo:work=>f.lifecycle.transition(work),collectionFeature:()=>true,updateChrome(){},saveStatus:(...args)=>f.lifecycle.setSaveStatus(...args),makeRequestId:()=> 'finish',collectionPath:()=>'/collection',questionsCache:{deleteCollection(){}},renderOutline(){},request:async(_path,options)=>{if(!options)return {questions:[]};await gate.promise;if(fail)throw error;return {historyId:'history'};}};
  vm.runInNewContext(source.slice(source.indexOf('async function finishPractice('),source.indexOf('\nasync function restartPractice('))+'\nglobalThis.finish=finishPractice;',sandbox);
  const run=sandbox.finish(pane,summary);await tick();assert.equal(f.lifecycle.pendingWrites,1);assert.equal(shouldWarnBeforeUnload([],f.lifecycle.pendingWrites),true);assert.equal(pane.node.inert,true);
  gate.resolve();if(fail){await assert.rejects(run,value=>value===error);assert.equal(f.lifecycle.saveStatus.type,'error');}else{assert.equal((await run).historyId,'history');assert.equal(f.lifecycle.saveStatus.text,'练习已完成');}
  await f.lifecycle.settled();assert.equal(f.lifecycle.pendingWrites,0);assert.equal(pane.node.inert,false);assert.equal(pane.loading,false);
});
