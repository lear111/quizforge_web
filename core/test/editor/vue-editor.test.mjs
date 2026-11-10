import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindEditorUi,renderEditorStatus} from '../../web/editor/editor-navigation.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const makePane=()=>({view:'edit',questionId:'a',editorSession:{isDirty:false},collection:{features:{history:true}}});
function fixture(t,run=async()=>{}){
  const dom=new JSDOM(readFileSync(new URL('../../web/index.html',import.meta.url),'utf8'),{runScripts:'outside-only'});loadVueUi(dom);
  const document=dom.window.document,dialog=document.querySelector('#editor-leave-dialog'),calls=[];
  dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>{dialog.removeAttribute('open');dialog.dispatchEvent(new dom.window.Event('close'));};
  let pane=makePane();const options={document,getPane:()=>pane,onCommand:async(command,owner,current)=>{calls.push([command,owner,current]);return run(command,owner,current);}};
  const binding=bindEditorUi(options);binding.update(pane);t.after(()=>{binding.destroy();dom.window.close();});
  return {dom,document,dialog,binding,options,calls,get pane(){return pane;},set pane(value){pane=value;},node:selector=>document.querySelector(selector),async click(selector){document.querySelector(selector).click();await tick();},update:()=>binding.update(pane)};
}

test('the editor bar keeps labels, native layout, focus and small plain display snapshots',t=>{
  const f=fixture(t),button=f.node('#edit-save');button.focus();
  Object.defineProperty(f.pane,'question',{get(){assert.fail('Question content must not enter the toolbar');}});
  f.pane.editorSession.isDirty=true;renderEditorStatus(f.document,f.pane);
  assert.equal(f.node('#edit-save'),button);assert.equal(f.document.activeElement,button);
  assert.match(f.node('#mode-label').textContent,/本题修改未保存/);assert.equal(f.node('#edit-save').textContent,'保存本题');assert.equal(f.node('#edit-cancel').textContent,'取消编辑');
  assert.equal(f.node('#mode-bar').children.length,2);assert.equal(f.node('#history-choose').hidden,true);
  const status=f.node('#save-state');status.className='save-state error';status.textContent='保存失败';renderEditorStatus(f.document,f.pane);assert.equal(status.textContent,'保存失败');
});

test('pending commands lock immediately, report errors through the host and permit retry on the same form',async t=>{
  let gate=deferred();const f=fixture(t,()=>gate.promise),session=f.pane.editorSession;
  await f.click('#edit-save');assert.equal(f.node('#edit-cancel').disabled,true);await f.click('#edit-save');assert.equal(f.calls.length,1);
  gate.reject(new Error('host reports this'));await tick();assert.equal(f.node('#edit-save').disabled,false);assert.equal(f.pane.editorSession,session);
  gate=deferred();await f.click('#edit-save');assert.equal(f.calls.length,2);gate.resolve();await tick();assert.equal(f.node('#edit-save').disabled,false);
});

test('queued commands capture the original pane and cannot target a different active bank',async t=>{
  const gate=deferred(),executed=[],f=fixture(t,async(command,owner,current)=>{await gate.promise;if(current())executed.push([command,owner]);});
  const original=f.pane;await f.click('#edit-save');f.pane=makePane();f.update();gate.resolve();await tick();
  assert.equal(f.calls[0][1],original);assert.deepEqual(executed,[]);assert.equal(f.node('#edit-save').disabled,false);
});

for(const change of ['question','session','leave-return'])test('queued edit invalidates across '+change+' even when the pane is reused',async t=>{
  const gate=deferred(),executed=[],f=fixture(t,async(_command,_owner,current)=>{await gate.promise;if(current())executed.push(true);});
  await f.click('#edit-cancel');
  if(change==='question')f.pane.questionId='b';else if(change==='session')f.pane.editorSession={isDirty:false};else{f.pane.view='practice';f.update();f.pane.view='edit';}
  f.update();gate.resolve();await tick();assert.deepEqual(executed,[]);assert.equal(f.node('#edit-save').disabled,false);
});

test('an old completion cannot unlock a pending command on a replacement form',async t=>{
  const old=deferred(),next=deferred();let calls=0;const f=fixture(t,()=>++calls===1?old.promise:next.promise);
  await f.click('#edit-save');f.pane=makePane();f.update();await f.click('#edit-cancel');
  old.reject(new Error('late failure'));await tick();assert.equal(f.node('#edit-save').disabled,true);next.resolve();await tick();assert.equal(f.node('#edit-save').disabled,false);
});

test('destroy invalidates queued commands, detached buttons and late status without remounting',async t=>{
  const gate=deferred(),executed=[],f=fixture(t,async(_command,_owner,current)=>{await gate.promise;if(current())executed.push(true);});
  const button=f.node('#edit-save');await f.click('#edit-save');f.binding.destroy();f.binding.destroy();button.click();gate.resolve();await tick();renderEditorStatus(f.document,f.pane);
  assert.deepEqual(executed,[]);assert.equal(f.node('#mode-bar').children.length,0);assert.equal(f.dialog.open,false);
});

test('rebinding leaves one handler and old toolbar/notice buttons cannot affect the new binding',async t=>{
  const f=fixture(t),oldSave=f.node('#edit-save');f.binding.showNotice(new Error('old'));const oldReturn=f.node('#editor-leave-return');
  const next=bindEditorUi(f.options);t.after(()=>next.destroy());next.update(f.pane);next.showNotice(new Error('new'));
  oldSave.click();oldReturn.click();assert.equal(f.dialog.open,true);assert.equal(f.calls.length,0);
  f.binding.showNotice(new Error('late'));assert.equal(f.node('#editor-leave-message').textContent,'new');await f.click('#editor-leave-return');assert.equal(f.dialog.open,false);
  await f.click('#edit-save');assert.equal(f.calls.length,1);
});

test('leave notices are plain text, allow close/reopen and ignore queued close from an old dialog',async t=>{
  const f=fixture(t);f.binding.showNotice(new Error('<img src=x> 请先保存'));assert.equal(f.dialog.querySelector('img'),null);assert.equal(f.dialog.querySelectorAll('button').length,1);
  assert.equal(f.node('#editor-leave-message').textContent,'<img src=x> 请先保存');await f.click('#editor-leave-return');
  f.binding.showNotice(new Error('again'));f.dialog.dispatchEvent(new f.dom.window.Event('close'));assert.equal(f.node('#editor-leave-message').textContent,'again');assert.equal(f.dialog.open,true);
  f.pane=makePane();f.update();assert.equal(f.dialog.open,false);
});

test('history and deleted-history labels preserve progress, exam marker, precision and available actions',async t=>{
  const f=fixture(t);f.pane.view='history';f.pane.historyEntry={mode:'exam',status:'completed',submittedCount:1,questionCount:3,createdAt:'2026-11-09T00:00:00Z'};f.update();
  assert.match(f.node('#mode-label').textContent,/只读历史 · 考试 · 已完成 · 已提交 1 \/ 3 题/);assert.equal(f.node('#edit-save').hidden,true);assert.equal(f.node('#return-practice').hidden,false);
  await f.click('#return-practice');assert.equal(f.calls[0][0],'return');f.pane.view='history-deleted';f.update();assert.equal(f.node('#mode-label').textContent,'记录已删除，请选择其他记录或返回作答。');
  f.pane.collection.features.history=false;f.update();await f.click('#history-choose');assert.equal(f.calls.length,1);
});

test('hidden, loading and closed contexts cannot invoke even programmatically clicked controls',async t=>{
  const f=fixture(t);for(const view of ['practice','summary']){f.pane.view=view;f.update();await f.click('#edit-save');await f.click('#return-practice');assert.equal(f.node('#mode-bar').hidden,true);}
  f.pane.view='edit';f.pane.loading=true;f.update();await f.click('#edit-save');f.pane.loading=false;f.update();f.pane.closed=true;await f.click('#edit-cancel');assert.equal(f.calls.length,0);
});

test('actual host dispatcher uses the captured pane, explicit discard and a guard inside the queue',async t=>{
  const f=fixture(t),source=readFileSync(new URL('../../web/app.js',import.meta.url),'utf8'),queued=[],seen=[];
  f.binding.destroy();
  const sandbox={document:f.document,bindEditorUi,active:()=>f.pane,transitionTo:work=>new Promise(resolve=>queued.push(async()=>{await work();resolve();})),saveEditor:owner=>seen.push(['save',owner]),returnToPractice:(owner,options)=>seen.push(['return',owner,options?.discard]),openHistoryList:owner=>seen.push(['choose',owner])};
  const start=source.indexOf('const editorUi=bindEditorUi('),end=source.indexOf('\nconst draftFullscreen=',start);vm.runInNewContext(source.slice(start,end)+'\nglobalThis.ui=editorUi;',sandbox);t.after(()=>sandbox.ui.destroy());sandbox.ui.update(f.pane);
  await f.click('#edit-cancel');await queued.shift()();await tick();assert.equal(seen[0][0],'return');assert.equal(seen[0][1],f.pane);assert.equal(seen[0][2],true);
  await f.click('#edit-save');const old=f.pane;f.pane=makePane();sandbox.ui.update(f.pane);await queued.shift()();await tick();assert.equal(seen.length,1);assert.notEqual(f.pane,old);
  await f.click('#edit-save');await queued.shift()();await tick();assert.deepEqual(seen[1],['save',f.pane]);
  f.pane.view='history-deleted';sandbox.ui.update(f.pane);await f.click('#history-choose');await queued.shift()();await tick();assert.deepEqual(seen[2],['choose',f.pane]);
  await f.click('#return-practice');await queued.shift()();await tick();assert.deepEqual(seen[3],['return',f.pane,undefined]);
});
