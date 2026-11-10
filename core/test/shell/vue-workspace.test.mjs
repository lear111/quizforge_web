import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindWorkspaceChrome,bindSaveStatus,renderSaveStatus} from '../../web/shell/workspace-view.js';
import {createCollectionLoading} from '../../web/practice/collection-loading.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
const model={title:'演示题库',group:'分组',progress:'第 1 题 / 共 2 题',busy:false,draftHidden:false,drafting:false,draftLabel:'草稿',historyHidden:false,editHidden:false};
function fixture(t,onCommand=async()=>{}){
  const dom=new JSDOM(html,{runScripts:'outside-only'});loadVueUi(dom);const document=dom.window.document,calls=[];
  let pane={view:'practice',questionId:'a'};
  const config={document,getPane:()=>pane,onCommand:async(...args)=>{calls.push(args);await onCommand(...args);}};
  const chrome=bindWorkspaceChrome(config);chrome.update(pane,model);
  t.after(()=>{chrome.destroy();dom.window.close();});
  return {dom,document,chrome,config,calls,get pane(){return pane;},set pane(value){pane=value;chrome.update(pane,model);},node:selector=>document.querySelector(selector)};
}

test('mount replaces fallback markup once, retains control IDs and renders titles and alerts as text',t=>{
  const f=fixture(t);f.chrome.update(f.pane,{...model,title:'<img src=x>',group:'<b>group</b>',progress:'<script>text</script>'});f.chrome.notice('<a href=x>error</a>');
  for(const id of ['document-title','document-group','draft-toggle','history-open','edit-open'])assert.equal(f.document.querySelectorAll('#'+id).length,1);
  assert.equal(f.node('#document-title').textContent,'<img src=x>');assert.equal(f.node('#document-group').textContent,'<b>group</b>');assert.equal(f.node('#notice a'),null);assert.equal(f.node('#notice').hidden,false);
  assert.equal(f.node('#progress-text script'),null);f.chrome.notice('');assert.equal(f.node('#notice').hidden,true);
});

test('action locks immediately, captures its original pane, and cannot execute twice while queued',async t=>{
  const gate=deferred();const f=fixture(t,()=>gate.promise);f.node('#edit-open').click();f.node('#history-open').click();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][1],f.pane);assert.equal(f.node('#draft-toggle').disabled,true);
  gate.resolve();await tick();assert.equal(f.node('#draft-toggle').disabled,false);
});

for(const change of ['pane','question','view'])test('queued toolbar action invalidates across '+change,async t=>{
  const gate=deferred(),executed=[];const f=fixture(t,async(_command,_pane,current)=>{await gate.promise;if(current())executed.push(true);});
  f.node('#draft-toggle').click();if(change==='pane')f.pane={view:'practice',questionId:'b'};else{f.pane[change==='view'?'view':'questionId']='changed';f.chrome.update(f.pane,model);}
  gate.resolve();await tick();assert.deepEqual(executed,[]);assert.equal(f.node('#draft-toggle').disabled,false);
});

test('hidden, busy and closed panes reject toolbar actions and draft labels preserve history distinction',async t=>{
  const f=fixture(t);f.chrome.update(f.pane,{...model,drafting:true,draftLabel:'返回练习'});assert.equal(f.node('#draft-toggle').getAttribute('aria-pressed'),'true');assert.match(f.node('#draft-toggle').textContent,/返回练习/);
  for(const state of [{...model,busy:true},{...model,draftHidden:true,editHidden:true,historyHidden:true}]){f.chrome.update(f.pane,state);for(const id of ['draft-toggle','history-open','edit-open'])f.node('#'+id).click();}
  f.chrome.update(f.pane,model);f.pane.closed=true;f.node('#edit-open').click();await tick();assert.equal(f.calls.length,0);
});

test('disposed and replaced toolbar buttons cannot remount, report notices or run commands',async t=>{
  const f=fixture(t),old=f.node('#edit-open');const next=bindWorkspaceChrome(f.config);t.after(()=>next.destroy());next.update(f.pane,{...model,title:'new'});
  old.click();f.chrome.notice('late');f.chrome.update(f.pane,model);assert.equal(f.node('#document-title').textContent,'new');assert.equal(f.node('#notice').hidden,true);assert.equal(f.calls.length,0);
  next.destroy();next.destroy();old.click();await tick();assert.equal(f.node('#workspace-actions-root').children.length,0);
});

test('save status has one Vue owner, preserves classes and plain text, and does not revive on late calls',t=>{
  const f=fixture(t),status=bindSaveStatus(f.document);status.update({text:'<b>保存失败</b>',type:'error'});
  assert.equal(f.node('#save-state').className,'save-state error');assert.equal(f.node('#save-state b'),null);
  const next=bindSaveStatus(f.document);t.after(()=>next.destroy());renderSaveStatus(f.document,{text:'new',type:'saving'});status.update({text:'old',type:'error'});assert.equal(f.node('#save-state').textContent,'new');
  next.destroy();renderSaveStatus(f.document,{text:'late',type:''});assert.equal(f.node('#save-state').textContent,'new');
});

test('loading generations ignore stale callbacks, finish is final, and disposal clears parent busy state',t=>{
  const f=fixture(t),loading=createCollectionLoading(f.document);t.after(()=>loading.destroy());
  assert.equal(f.document.querySelectorAll('.collection-loading-title').length,1);
  const old=loading.begin('old'),next=loading.begin('<b>new</b>');old.finish();old.setDetail('stale');next.setDetail('首题');
  assert.equal(f.node('.collection-loading-title').textContent,'<b>new</b>');assert.equal(f.node('#collection-loading b'),null);assert.equal(f.node('#panes').getAttribute('aria-busy'),'true');
  next.finish();next.setDetail('late');assert.equal(f.node('.collection-loading-detail').textContent,'首题');assert.equal(f.node('#panes').hasAttribute('aria-busy'),false);
  const pending=loading.begin('pending');loading.destroy();pending.finish();pending.setDetail('late');loading.begin('cannot revive');assert.equal(f.node('#collection-loading').hidden,true);assert.equal(f.node('#collection-loading').children.length,0);
});

test('real host toolbar dispatch rechecks ownership inside the shared transition queue',async t=>{
  const f=fixture(t),queued=[],seen=[];f.chrome.destroy();
  const source=readFileSync(new URL('../../web/app.js',import.meta.url),'utf8'),start=source.indexOf('const workspaceChrome=bindWorkspaceChrome('),end=source.indexOf('\nconst editorUi=',start);
  const sandbox={document:f.document,bindWorkspaceChrome,active:()=>f.pane,transitionTo:work=>new Promise(resolve=>queued.push(async()=>{await work();resolve();})),toggleDraftMode:()=>seen.push('draft'),openHistoryList:pane=>seen.push(['history',pane]),openEditor:pane=>seen.push(['edit',pane])};
  vm.runInNewContext(source.slice(start,end)+'\nglobalThis.chrome=workspaceChrome;',sandbox);t.after(()=>sandbox.chrome.destroy());sandbox.chrome.update(f.pane,model);
  f.node('#history-open').click();const old=f.pane;f.pane={view:'practice',questionId:'b'};sandbox.chrome.update(f.pane,model);await queued.shift()();await tick();assert.deepEqual(seen,[]);
  f.node('#edit-open').click();await queued.shift()();await tick();assert.equal(seen[0][0],'edit');assert.equal(seen[0][1],f.pane);assert.notEqual(f.pane,old);
});
