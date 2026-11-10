import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {createEditorSession} from '../../web/editor/editor-session.js';
import {checkEditorExit,renderEditorStatus,bindEditorLeaveNotice,shouldWarnBeforeUnload} from '../../web/editor/editor-navigation.js';

const source=readFileSync(new URL('../../web/app.js',import.meta.url),'utf8');
function editor({changed=false,invalid=false,broken=false}={}){
  const form={changed,invalid},calls=[],session=createEditorSession(),plugin={
    get isDirty(){return form.changed;},async flush(){calls.push('flush');},
    async getDocument({checkOnly=false}={}){calls.push(checkOnly?'check':'validate');if(broken)throw new Error('read failed');if(!checkOnly&&form.invalid)throw new Error('invalid');return {changed:form.changed,document:{title:'题目',data:{stem:'题干'}}};},
    destroy(){calls.push('destroy');}
  };
  session.add('q1',{plugin,value:{}});
  return {form,calls,pane:{key:'bank:one',view:'edit',node:{inert:false,classList:{remove(){}}},questionId:'q1',plugin,editorSession:session}};
}

test('unchanged and reverted edits may leave without validating incomplete question content',async()=>{
  const f=editor({invalid:true});assert.equal(await checkEditorExit(f.pane),true);assert.deepEqual(f.calls,['flush','check']);
  f.form.changed=true;await assert.rejects(checkEditorExit(f.pane),error=>error.code==='UNSAVED_EDITOR_CHANGES');
  f.form.changed=false;assert.equal(await checkEditorExit(f.pane),true);
});

test('ordinary navigation blocks dirty input without offering to discard or writing it',async()=>{
  const f=editor({changed:true,invalid:true});let confirmations=0;
  await assert.rejects(checkEditorExit(f.pane,{confirmDiscard:()=>{confirmations++;return true;}}),error=>error.code==='UNSAVED_EDITOR_CHANGES'&&/先保存或取消/.test(error.message));
  assert.equal(confirmations,0);assert.equal(f.form.changed,true);assert.equal(f.pane.editorSession.values().length,1);assert.deepEqual(f.calls,['flush','check']);
});

test('cancel editing is the only exit that offers explicit discard, and cancelling preserves the editor',async()=>{
  const f=editor({changed:true});assert.equal(await checkEditorExit(f.pane,{discard:true,confirmDiscard:()=>false}),false);
  assert.equal(f.form.changed,true);assert.equal(await checkEditorExit(f.pane,{discard:true,confirmDiscard:()=>true}),true);
  assert.ok(!f.calls.includes('destroy'));
});

test('failed state inspection blocks navigation but still allows explicit cancellation',async()=>{
  const f=editor({broken:true});await assert.rejects(checkEditorExit(f.pane),error=>error.code==='UNSAVED_EDITOR_CHANGES'&&/read failed/.test(error.message));
  assert.equal(await checkEditorExit(f.pane,{discard:true,confirmDiscard:()=>true}),true);
});

test('refreshing does not warn or save authoring edits; practice and in-flight saves retain protection',()=>{
  const f=editor({changed:true});f.pane.plugin.hasUnsavedInput=true;
  assert.equal(shouldWarnBeforeUnload([f.pane],0),false);assert.equal(shouldWarnBeforeUnload([f.pane],1),true);
  for(const pane of [{view:'practice',ink:{pending:true}},{view:'practice',writes:{hasFailures:true}},{view:'practice',plugin:{hasUnsavedInput:true}}])assert.equal(shouldWarnBeforeUnload([f.pane,pane],0),true);
  assert.deepEqual(f.calls,[]);
});

test('top bar describes only the current question without replacing save errors',t=>{
  const dom=new JSDOM(readFileSync(new URL('../../web/index.html',import.meta.url),'utf8'),{runScripts:'outside-only'});loadVueUi(dom);t.after(()=>dom.window.close());const document=dom.window.document,f=editor();
  renderEditorStatus(document,f.pane);assert.equal(document.querySelector('#edit-save').textContent,'保存本题');assert.equal(document.querySelector('#edit-cancel').textContent,'取消编辑');
  assert.match(document.querySelector('#mode-label').textContent,/本题未修改/);f.form.changed=true;renderEditorStatus(document,f.pane);assert.match(document.querySelector('#mode-label').textContent,/本题修改未保存/);
  const status=document.querySelector('#save-state');status.textContent='network error';status.classList.add('error');renderEditorStatus(document,f.pane);assert.equal(status.textContent,'network error');
  assert.equal(document.querySelector('#editor-pending-dialog'),null);
});

test('blocked navigation shows a return-only dialog and renders error text safely',t=>{
  const dom=new JSDOM(readFileSync(new URL('../../web/index.html',import.meta.url),'utf8'),{runScripts:'outside-only'});loadVueUi(dom);t.after(()=>dom.window.close());const document=dom.window.document,dialog=document.querySelector('#editor-leave-dialog');
  dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};const show=bindEditorLeaveNotice(document);
  show(new Error('<img src=x> 请先保存'));assert.equal(dialog.open,true);assert.equal(dialog.querySelector('img'),null);assert.equal(dialog.querySelectorAll('button').length,1);
  document.querySelector('#editor-leave-return').click();assert.equal(dialog.open,false);
});

function navigation(f){
  const calls=[],sandbox={checkEditorExit,confirm:()=>{calls.push('confirm');return true;},flushPane:async()=>calls.push('practice-flush'),showQuestion:async(pane,qid)=>{calls.push(['show',qid]);pane.editorSession?.destroy();pane.editorSession=null;pane.view='practice';pane.questionId=qid;},allowLeaveDevelopmentInput:()=>true,loadQuestion:async()=>({}),request:async()=>({questions:[{id:'q1'},{id:'q2'}]}),collectionPath:()=>'/collection'};
  const start=source.indexOf('async function allowDiscardEditor('),end=source.indexOf('// Warm the neighbouring cards',start);
  const navStart=source.indexOf('async function navigateQuestion('),navEnd=source.indexOf('\nasync function showScoreSummary(',navStart);
  vm.runInNewContext(source.slice(start,end)+source.slice(navStart,navEnd)+'\nglobalThis.nav={navigateQuestion,returnToPractice,allowDiscardEditor};',sandbox);
  return {calls,nav:sandbox.nav,sandbox,pane:f.pane};
}

test('actual question-navigation host blocks changed forms and never mounts a second editor',async()=>{
  const f=editor({changed:true}),host=navigation(f);await assert.rejects(host.nav.navigateQuestion(f.pane,'q2'),error=>error.code==='UNSAVED_EDITOR_CHANGES');
  assert.equal(f.pane.questionId,'q1');assert.equal(f.pane.view,'edit');assert.deepEqual(host.calls,[]);
});

test('actual question-navigation host directly leaves a clean editor into the next practice question',async()=>{
  const f=editor(),host=navigation(f);await host.nav.navigateQuestion(f.pane,'q2');assert.equal(f.pane.view,'practice');assert.equal(f.pane.questionId,'q2');assert.equal(f.pane.editorSession,null);assert.deepEqual(host.calls,['practice-flush',['show','q2']]);
});

test('clicking the current outline question does not discard or remount an edit',async()=>{
  const f=editor({changed:true}),host=navigation(f);await host.nav.navigateQuestion(f.pane,'q1');assert.deepEqual(f.calls,[]);assert.deepEqual(host.calls,[]);
});

test('explicit cancellation can exit a failed editor without running its failing flush again',async()=>{
  const f=editor({changed:true}),host=navigation(f);f.pane.plugin.flush=async()=>{throw new Error('broken editor');};
  assert.equal(await host.nav.returnToPractice(f.pane,{discard:true}),true);
  assert.equal(f.pane.view,'practice');assert.deepEqual(host.calls,['confirm',['show','q1']]);
});

test('directory operations reject current edits before flushing other panes or sending directory writes',async()=>{
  const f=editor({changed:true}),calls=[],sandbox={collections:new Map([['one',f.pane]]),transitionTo:fn=>fn(),allowDiscardEditor:target=>checkEditorExit(target),returnToPractice:()=>{calls.push('exit');},flushPane:()=>{calls.push('flush');}};
  const start=source.indexOf('const prepareLibraryChange='),end=source.indexOf('\nasync function applyLibraryChange(',start);
  vm.runInNewContext(source.slice(start,end)+'\nglobalThis.prepare=prepareLibraryChange;',sandbox);
  await assert.rejects(sandbox.prepare(),error=>error.code==='UNSAVED_EDITOR_CHANGES');assert.deepEqual(calls,[]);assert.equal(f.pane.view,'edit');
});

test('actual cancel-button handler explicitly requests discard, while navigation does not',()=>{
  assert.match(source,/if\(command==='cancel'\)return returnToPractice\(pane,\{discard:true\}\)/);
  assert.doesNotMatch(source,/editor-drafts|persistEditorDraft|exportDraft|saveAll|editor-pending/);
});
