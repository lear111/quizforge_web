import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindHistoryList} from '../../web/history/history-list.js';
import {historyProgress} from '../../web/history/history-view.js';
import {collectionFeature} from '../../web/practice/practice-context.js';

const source=readFileSync(new URL('../../web/app.js',import.meta.url),'utf8');
const start=source.indexOf('const historyPath=');
const end=source.indexOf('async function showHistory(',start);
assert.ok(start>=0&&end>start,'The production history-list controller must be present');
const historySource=source.slice(start,end);
const elementSource=source.split(/\r?\n/).find(line=>line.startsWith('const el='));
const summaryDisposalSource=source.split(/\r?\n/).find(line=>line.startsWith('function disposeScoreSummary('));
// Run the actual host wiring and production Vue UI against a DOM and transport. The
// fixture supplies no deletion logic: confirmation, locks, recovery and rendering
// are all exercised through the same click handlers used by the browser.
function fixture(t,{requestImpl=async()=>({}),returnError=null,records=2,view='practice',exam=false}={}){
  const dom=new JSDOM(readFileSync(new URL('../../web/index.html',import.meta.url),'utf8'),{runScripts:'outside-only'}),document=dom.window.document;
  loadVueUi(dom);
  const requests=[],confirmations=[],opened=[],transitions=[],loads=[],status=[];
  for(const dialog of document.querySelectorAll('dialog')){
    Object.defineProperty(dialog,'shown',{get:()=>dialog.open});Object.defineProperty(dialog,'closed',{get:()=>!dialog.open});
    dialog.showModal=()=>{dialog.setAttribute('open','');if(dialog.id==='history-delete-dialog')confirmations.push(document.querySelector('#history-delete-detail').textContent);};
    dialog.close=()=>{dialog.removeAttribute('open');dialog.dispatchEvent(new dom.window.Event('close'));};
  }
  const nodes=new Map();for(const id of ['history-dialog','history-list','history-title','history-error','history-close','history-delete-dialog','history-delete-detail','history-delete-cancel','history-delete-confirm'])nodes.set('#'+id,document.querySelector('#'+id));
  const pane={kind:'bank',id:'bank',view,questionId:'q1',collection:{title:'测试题库'},historyRecords:Array.from({length:records},(_,index)=>({id:`round-${index+1}`,collectionTitle:'测试题库',createdAt:`2026-10-07T0${index+1}:00:00Z`,updatedAt:`2026-10-07T0${index+1}:01:00Z`,status:'completed',submittedCount:2,questionCount:2,score:2,maxScore:2})),frameHost:document.createElement('div'),whiteboard:{load:value=>loads.push(value)}};
  if(exam)Object.assign(pane.historyRecords[0],{id:'exam-attempt',mode:'exam',examId:'attempt'});
  if(view==='history'){pane.historyEntry={id:pane.historyRecords[0].id};pane.historyView={frozen:true};pane.historyQuestion={frozen:true};pane.historyQuestionId='q1';pane.plugin={destroy(){pane.pluginDestroyed=true;}};}
  const sandbox={document,Date,Promise,encodeURIComponent,historyProgress,collectionFeature,bindHistoryList,allowDiscardEditor:async()=>true,
    $:selector=>document.querySelector(selector),collectionPath:(kind,id)=>`/api/collections/${kind}/${id}`,
    request:async(path,options)=>{requests.push({path,options});return requestImpl(path,options);},
    transitionTo:fn=>{const operation=Promise.resolve().then(fn);transitions.push(operation);operation.catch(()=>{});return operation;},
    showHistory:async(_pane,id)=>opened.push(id),flushPane:async()=>{},
    returnToPractice:async()=>{if(returnError)throw returnError;pane.view='practice';},
    renderOutline(){},updateChrome(){},saveStatus:value=>status.push(value),
  };
  pane.node={classList:{remove(){}}};
  vm.runInNewContext(`${elementSource}\n${summaryDisposalSource}\n${historySource}\nglobalThis.controller={renderHistoryList,openHistoryList,historyManager};`,sandbox);
  sandbox.controller.historyManager.prepare(pane);sandbox.controller.historyManager.show();
  for(const id of nodes.keys())nodes.set(id,document.querySelector(id));
  t.after(()=>{sandbox.controller.historyManager.destroy();dom.window.close();});
  const list=nodes.get('#history-list');
  return {pane,nodes,requests,confirmations,opened,loads,status,document,
    dispatch(node,name){const event=new dom.window.Event(name,{cancelable:true});node.dispatchEvent(event);return event;},
    row:index=>list.children[index].querySelector('.history-row'),
    remove:index=>list.children[index].querySelector('.history-delete'),
    delete(index,accepted=true){list.children[index].querySelector('.history-delete').click();nodes.get(accepted?'#history-delete-confirm':'#history-delete-cancel').click();},
    async settled(){await tick();for(let index=0;index<transitions.length;index++)await transitions[index].catch(()=>{});await tick();},
    reopen:()=>sandbox.controller.openHistoryList(pane)};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('canceling delete leaves the record intact and does not open it',async t=>{
  const f=fixture(t);f.delete(0,false);await f.settled();
  assert.equal(f.confirmations.length,1);assert.equal(f.requests.length,0);assert.equal(f.pane.historyRecords.length,2);assert.equal(f.opened.length,0);assert.equal(f.nodes.get('#history-list').children.length,2);
});

test('exam records are labeled and share the normal history viewing and deletion controls',async t=>{
  const f=fixture(t,{exam:true});assert.equal(f.row(0).querySelector('.history-exam-badge').textContent,'考试');assert.equal(f.row(1).querySelector('.history-exam-badge'),null);
  f.row(0).click();await f.settled();assert.deepEqual(f.opened,['exam-attempt']);
  const deleted=fixture(t,{exam:true,view:'history'});assert.match(deleted.remove(0).getAttribute('aria-label'),/考试历史记录/);
  deleted.delete(0);await deleted.settled();assert.match(deleted.confirmations[0],/^考试 · /);
  assert.equal(deleted.requests[0].path,'/api/collections/bank/bank/history/exam-attempt');assert.equal(deleted.requests[0].options.method,'DELETE');
  assert.equal(deleted.pane.view,'practice');assert.deepEqual(deleted.pane.historyRecords.map(row=>row.id),['round-2']);
});

test('history opened from a completed exam also uses its original bank history endpoint',async t=>{
  const f=fixture(t,{exam:true,requestImpl:async()=>({records:[]})});
  Object.assign(f.pane,{kind:'exam',id:'attempt',exam:{bankKind:'bank',bankId:'original-bank',status:'completed'}});
  await f.reopen();assert.equal(f.requests[0].path,'/api/collections/bank/original-bank/history');
});

test('confirmation locks the list before awaiting a decision and ignores duplicate clicks',async t=>{
  const f=fixture(t),remove=f.remove(0),open=f.row(1);remove.click();
  assert.equal(f.nodes.get('#history-delete-dialog').shown,true);assert.equal(f.nodes.get('#history-list').getAttribute('aria-busy'),'true');assert.equal(remove.disabled,true);assert.equal(open.disabled,true);assert.equal(f.nodes.get('#history-close').disabled,true);
  assert.equal(f.nodes.get('#history-delete-cancel').disabled,false);assert.equal(f.nodes.get('#history-delete-confirm').disabled,false);
  f.dispatch(remove,'click');f.dispatch(open,'click');await tick();
  assert.equal(f.confirmations.length,1);assert.equal(f.requests.length,0);assert.equal(f.opened.length,0);
  f.nodes.get('#history-delete-cancel').click();await f.settled();assert.equal(f.pane.historyRecords.length,2);assert.equal(remove.disabled,false);assert.equal(f.nodes.get('#history-delete-dialog').shown,false);
});

test('Escape cancels the confirmation and does not dismiss or modify the history list',async t=>{
  const f=fixture(t);f.remove(0).click();
  assert.equal(f.dispatch(f.nodes.get('#history-delete-dialog'),'cancel').defaultPrevented,true);await f.settled();
  assert.equal(f.nodes.get('#history-delete-dialog').shown,false);assert.equal(f.nodes.get('#history-dialog').closed,false);assert.equal(f.pane.historyRecords.length,2);assert.equal(f.requests.length,0);assert.equal(f.nodes.get('#history-list').getAttribute('aria-busy'),'false');
});

test('closing confirmation without accepting also cancels the pending decision',async t=>{
  const f=fixture(t);f.remove(0).click();f.nodes.get('#history-delete-dialog').close();await f.settled();
  assert.equal(f.pane.historyRecords.length,2);assert.equal(f.requests.length,0);assert.equal(f.remove(0).disabled,false);
});

test('open and delete are separate controls; deletion refreshes the row and restores focus',async t=>{
  const f=fixture(t);assert.equal(f.row(0).parentElement,f.remove(0).parentElement);assert.notEqual(f.row(0),f.remove(0));
  f.remove(0).focus();f.delete(0);await f.settled();
  assert.equal(f.opened.length,0);assert.equal(f.nodes.get('#history-dialog').closed,false);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.method,'DELETE');assert.equal(f.requests[0].path,'/api/collections/bank/bank/history/round-1');
  assert.deepEqual(f.pane.historyRecords.map(row=>row.id),['round-2']);assert.equal(f.nodes.get('#history-list').children.length,1);
  assert.equal(f.document.activeElement,f.row(0));assert.equal(f.document.activeElement.disabled,false);
  f.row(0).click();await f.settled();assert.deepEqual(f.opened,['round-2']);assert.equal(f.nodes.get('#history-dialog').closed,true);
});

test('pending deletion blocks duplicate requests, opening records and Escape dismissal',async t=>{
  const pending=deferred(),f=fixture(t,{requestImpl:()=>pending.promise}),remove=f.remove(0),open=f.row(1);
  remove.click();assert.equal(f.nodes.get('#history-delete-dialog').shown,true);assert.equal(f.requests.length,0);
  f.nodes.get('#history-delete-confirm').click();await tick();assert.equal(f.requests.length,1);
  assert.equal(f.nodes.get('#history-list').getAttribute('aria-busy'),'true');assert.equal(f.nodes.get('#history-close').disabled,true);
  f.dispatch(remove,'click');f.dispatch(open,'click');assert.equal(f.confirmations.length,1);assert.equal(f.opened.length,0);assert.equal(f.requests.length,1);
  assert.equal(f.dispatch(f.nodes.get('#history-dialog'),'cancel').defaultPrevented,true);
  pending.resolve({});await f.settled();
  assert.equal(f.nodes.get('#history-list').getAttribute('aria-busy'),'false');assert.equal(f.nodes.get('#history-close').disabled,false);
  assert.equal(f.dispatch(f.nodes.get('#history-dialog'),'cancel').defaultPrevented,false);
});

test('a failed server write preserves the row and current frozen view for retry',async t=>{
  const failure=new Error('写入失败'),f=fixture(t,{view:'history',requestImpl:async()=>{throw failure;}});
  const before=f.pane.historyEntry;f.delete(0);await f.settled();
  assert.equal(f.pane.historyRecords.length,2);assert.equal(f.nodes.get('#history-list').children.length,2);assert.equal(f.pane.historyEntry,before);assert.equal(f.pane.pluginDestroyed,undefined);
  assert.match(f.nodes.get('#history-error').textContent,/删除失败：写入失败/);assert.equal(f.nodes.get('#history-error').hidden,false);assert.equal(f.remove(0).disabled,false);
});

test('deleting the displayed record clears its snapshot and returns to current practice',async t=>{
  const f=fixture(t,{view:'history'});f.delete(0);await f.settled();
  assert.equal(f.pane.view,'practice');assert.equal(f.pane.pluginDestroyed,true);assert.equal(f.pane.plugin,null);
  for(const key of ['historyEntry','historyView','historyQuestion','historyQuestionId'])assert.equal(f.pane[key],null);
  assert.deepEqual(f.loads,[null]);assert.deepEqual(f.status,['记录已删除']);assert.equal(f.pane.historyRecords.length,1);
});

test('a failed return after deletion cannot keep the deleted snapshot alive',async t=>{
  const f=fixture(t,{view:'history',returnError:new Error('题库已移除')});f.delete(0);await f.settled();
  assert.equal(f.pane.view,'history-deleted');assert.equal(f.pane.historyEntry,null);assert.equal(f.pane.historyView,null);assert.equal(f.pane.plugin,null);
  assert.match(f.pane.frameHost.children[0].textContent,/此历史记录已删除/);assert.match(f.nodes.get('#history-error').textContent,/记录已删除，但返回作答失败：题库已移除/);assert.equal(f.pane.historyRecords.length,1);
});

test('already-deleted response removes a stale row and focuses close for an empty list',async t=>{
  const error=Object.assign(new Error('已不存在'),{status:404}),f=fixture(t,{records:1,requestImpl:async()=>{throw error;}});
  f.delete(0);await f.settled();
  assert.equal(f.pane.historyRecords.length,0);assert.equal(f.nodes.get('#history-error').hidden,true);assert.equal(f.document.activeElement,f.nodes.get('#history-close'));assert.equal(f.document.activeElement.disabled,false);
  assert.match(f.nodes.get('#history-list').children[0].textContent,/还没有历史记录/);
});

test('a lost delete response retains local data until a fresh list verifies the result',async t=>{
  const timeout=Object.assign(new Error('等待超时'),{code:'REQUEST_TIMEOUT'}),f=fixture(t,{requestImpl:async(_path,options)=>{if(options?.method==='DELETE')throw timeout;return {records:[]};}});
  f.delete(0);await f.settled();
  assert.equal(f.pane.historyRecords.length,2);assert.match(f.nodes.get('#history-error').textContent,/重新打开历史列表确认是否已删除/);
  await f.reopen();assert.equal(f.pane.historyRecords.length,0);assert.equal(f.nodes.get('#history-error').hidden,true);assert.equal(f.requests.length,2);
});

test('a fresh list clears the displayed snapshot when a timed-out deletion actually succeeded',async t=>{
  const timeout=Object.assign(new Error('等待超时'),{code:'REQUEST_TIMEOUT'}),f=fixture(t,{view:'history',requestImpl:async(_path,options)=>{if(options?.method==='DELETE')throw timeout;return {records:[]};}});
  f.delete(0);await f.settled();assert.equal(f.pane.view,'history');assert.notEqual(f.pane.historyEntry,null);
  await f.reopen();assert.equal(f.pane.view,'practice');assert.equal(f.pane.historyEntry,null);assert.equal(f.pane.historyView,null);assert.equal(f.pane.pluginDestroyed,true);assert.equal(f.pane.historyRecords.length,0);
  assert.equal(f.nodes.get('#history-dialog').shown,true);assert.equal(f.nodes.get('#history-close').disabled,false);
});

test('fresh-list recovery preserves its error when the current bank cannot be loaded',async t=>{
  const f=fixture(t,{view:'history',returnError:new Error('题库已移除'),requestImpl:async()=>({records:[]})});
  await f.reopen();assert.equal(f.pane.view,'history-deleted');assert.equal(f.pane.historyEntry,null);assert.equal(f.pane.historyView,null);
  assert.match(f.nodes.get('#history-error').textContent,/记录已删除，但返回作答失败：题库已移除/);assert.equal(f.nodes.get('#history-error').hidden,false);assert.equal(f.nodes.get('#history-dialog').shown,true);assert.equal(f.nodes.get('#history-close').disabled,false);
});

test('a failed list refresh preserves the current rows and frozen view for a later retry',async t=>{
  let fail=true;
  const f=fixture(t,{view:'history',requestImpl:async()=>{if(fail)throw new Error('读取失败');return {records:[]};}}),before=f.pane.historyEntry;
  await assert.rejects(f.reopen(),/读取失败/);assert.equal(f.pane.historyEntry,before);assert.equal(f.nodes.get('#history-list').children.length,2);assert.equal(f.pane.pluginDestroyed,undefined);
  fail=false;await f.reopen();assert.equal(f.pane.historyRecords.length,0);assert.equal(f.pane.view,'practice');assert.equal(f.nodes.get('#history-dialog').open,true);
});
