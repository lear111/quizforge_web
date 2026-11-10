import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindHistoryList} from '../../web/history/history-list.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function pane(title='题库A',id='same-id'){
  return {collection:{title},historyRecords:[{id,collectionTitle:title,createdAt:'2026-11-09T01:00:00Z',status:'completed',submittedCount:1,questionCount:2,summary:{score:1.123456,maxScore:2.5},privateAnswer:'ANSWER_NOT_FOR_LIST'}]};
}
function fixture(t,callbacks={}){
  const dom=new JSDOM(readFileSync(new URL('../../web/index.html',import.meta.url),'utf8'),{runScripts:'outside-only'});loadVueUi(dom);
  const document=dom.window.document,dialog=document.querySelector('#history-dialog'),confirmation=document.querySelector('#history-delete-dialog');
  for(const node of [dialog,confirmation]){
    node.showModal=()=>node.setAttribute('open','');
    node.close=()=>{node.removeAttribute('open');node.dispatchEvent(new dom.window.Event('close'));};
  }
  const opened=[],removed=[];const options={document,onOpen:async(...args)=>{opened.push(args);return callbacks.open?.(...args);},onDelete:async(...args)=>{removed.push(args);return callbacks.remove?.(...args);}};
  const binding=bindHistoryList(options),owner=pane();binding.prepare(owner);binding.show();t.after(()=>{binding.destroy();dom.window.close();});
  return {dom,document,dialog,confirmation,binding,owner,opened,removed,options,
    node:selector=>document.querySelector(selector),async click(selector){document.querySelector(selector).click();await tick();},
    dispatch(node,name){const event=new dom.window.Event(name,{cancelable:true,bubbles:true});node.dispatchEvent(event);return event;}};
}

test('history display keeps scores, progress and exam labels and treats titles/errors as text',t=>{
  const f=fixture(t);f.owner.collection.title='<img src=x>';f.owner.historyRecords[0].collectionTitle='<script>bad()</script>';f.owner.historyRecords[0].mode='exam';f.binding.update(f.owner);
  assert.equal(f.node('.history-score').textContent,'1.123456 / 2.5');assert.match(f.node('.history-row small').textContent,/已完成 · 已提交 1 \/ 2 题/);
  assert.equal(f.node('.history-exam-badge').textContent,'考试');assert.match(f.node('#history-title').textContent,/<img src=x>/);assert.equal(f.node('#history-root img'),null);assert.equal(f.node('#history-root script'),null);
  f.binding.error('<iframe>bad</iframe>');assert.equal(f.node('#history-error').textContent,'<iframe>bad</iframe>');assert.equal(f.node('#history-root iframe'),null);assert.doesNotMatch(f.node('#history-root').textContent,/ANSWER_NOT_FOR_LIST/);
});

test('same-owner refresh preserves row node and focus without exposing the mutable host data',async t=>{
  const f=fixture(t),button=f.node('.history-row');button.focus();f.owner.historyRecords[0].summary.score=2;await tick();assert.equal(f.node('.history-score').textContent,'1.123456 / 2.5');
  f.binding.update(f.owner);assert.equal(f.node('.history-row'),button);assert.equal(f.document.activeElement,button);assert.equal(f.node('.history-score').textContent,'2 / 2.5');
});

test('destroy while confirming cancels without issuing deletion and old buttons stay inert after remount',async t=>{
  const f=fixture(t);await f.click('.history-delete');const oldConfirm=f.node('#history-delete-confirm'),oldRow=f.node('.history-row');assert.equal(f.confirmation.open,true);
  f.binding.destroy();f.binding.destroy();oldConfirm.click();oldRow.click();await tick();assert.equal(f.removed.length,0);assert.equal(f.opened.length,0);assert.equal(f.confirmation.open,false);assert.equal(f.dialog.open,false);
  const next=bindHistoryList(f.options);t.after(()=>next.destroy());next.prepare(f.owner);next.show();oldConfirm.click();await f.click('.history-row');assert.equal(f.opened.length,1);assert.equal(f.removed.length,0);
});

test('repeated binding destroys old listeners and leaves one confirmation and command',async t=>{
  const f=fixture(t),next=bindHistoryList(f.options);t.after(()=>next.destroy());next.prepare(f.owner);next.show();
  await f.click('.history-delete');assert.equal(f.confirmation.open,true);assert.equal(f.dispatch(f.dialog,'cancel').defaultPrevented,true);
  await f.click('#history-delete-confirm');assert.equal(f.removed.length,1);assert.equal(f.removed[0][0],f.owner);assert.equal(f.removed[0][1],'same-id');assert.equal(next.busy,false);
});

for(const reject of [false,true])test('late deletion response cannot write into a replacement binding: '+reject,async t=>{
  const gate=deferred(),f=fixture(t,{remove:()=>gate.promise});await f.click('.history-delete');await f.click('#history-delete-confirm');assert.equal(f.removed.length,1);f.binding.destroy();
  const next=bindHistoryList(f.options),newOwner=pane('题库B');t.after(()=>next.destroy());next.prepare(newOwner);next.show();
  if(reject)gate.reject(new Error('OLD_ERROR'));else gate.resolve();await tick();
  assert.equal(next.busy,false);assert.equal(f.node('#history-error').hidden,true);assert.match(f.node('#history-title').textContent,/题库B/);assert.equal(f.dialog.open,true);
});

test('externally closing the list cancels a pending decision and permits a fresh open',async t=>{
  const f=fixture(t);await f.click('.history-delete');f.dialog.close();await tick();assert.equal(f.confirmation.open,false);assert.equal(f.removed.length,0);assert.equal(f.binding.busy,false);
  f.binding.prepare(pane('题库B'));f.binding.show();await f.click('.history-row');assert.equal(f.opened[0][0].collection.title,'题库B');
});

test('closing and reopening during a server write isolates its error and old-pane updates',async t=>{
  const gate=deferred(),f=fixture(t,{remove:()=>gate.promise});await f.click('.history-delete');await f.click('#history-delete-confirm');f.dialog.close();
  const next=pane('题库B');f.binding.prepare(next);f.binding.show();f.owner.historyRecords=[];f.binding.update(f.owner);f.binding.error('OLD_RETURN_ERROR',f.owner);
  gate.reject(new Error('OLD_DELETE_ERROR'));await tick();assert.equal(f.node('#history-error').hidden,true);assert.match(f.node('.history-row').textContent,/题库B/);assert.equal(f.node('.history-row').disabled,false);
});

test('late native close notifications cannot cancel a newly opened list or confirmation',async t=>{
  const f=fixture(t);f.dialog.close();f.binding.prepare(pane('题库B'));f.binding.show();f.dispatch(f.dialog,'close');
  await f.click('.history-delete');f.dispatch(f.confirmation,'close');assert.equal(f.confirmation.open,true);assert.equal(f.binding.busy,true);await f.click('#history-delete-confirm');assert.equal(f.removed.length,1);
});

test('hidden or detached controls cannot invoke host commands',async t=>{
  const f=fixture(t),row=f.node('.history-row'),remove=f.node('.history-delete');f.dialog.close();f.dispatch(row,'click');f.dispatch(remove,'click');await tick();assert.equal(f.opened.length,0);assert.equal(f.removed.length,0);
  f.binding.show();f.node('#history-root').remove();row.click();remove.click();await tick();assert.equal(f.opened.length,0);assert.equal(f.removed.length,0);
});

test('opening a row calls the captured owner once and host failure does not leak an unhandled rejection',async t=>{
  const f=fixture(t,{open(){throw new Error('HOST_HANDLES_OPEN_ERROR');}}),button=f.node('.history-row');button.click();button.click();await tick();assert.equal(f.opened.length,1);assert.equal(f.opened[0][0],f.owner);assert.equal(f.dialog.open,false);
});
