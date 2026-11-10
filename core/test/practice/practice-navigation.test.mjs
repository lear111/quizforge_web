import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindPracticeNavigation} from '../../web/practice/practice-navigation.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
  const dom=new JSDOM('<button id="previous"></button><button id="next"></button><textarea></textarea><dialog><button>inside</button></dialog>',{runScripts:'outside-only'});loadVueUi(dom);
  const pane=()=>({view:'practice',questionId:'a',collection:{questions:['a','b','c'].map(id=>({id})),states:{}}});
  const a=pane(),b=pane(),calls=[],errors=[];let active=a,chain=Promise.resolve(),navigation;
  const enqueue=fn=>{const run=chain.then(fn);chain=run.catch(error=>errors.push(error));return run;};
  const config={document:dom.window.document,active:()=>active,transitionTo:enqueue,
    navigateQuestion:async(owner,id)=>{calls.push(['question',owner,id]);owner.questionId=id;},
    navigateOutlineTarget:async(owner,id,itemId)=>{calls.push(['jump',owner,id,itemId]);owner.questionId=id;owner.outlineItemId=itemId;},
    showScoreSummary:async owner=>{calls.push(['summary',owner]);owner.summaryShown=true;owner.view='summary';},
    renderOutline(){},closeDrawers:()=>calls.push(['close']),draftViewActive:owner=>!!owner.draftMode};
  const bind=()=>navigation=bindPracticeNavigation(config);bind();
  t.after(()=>{navigation.destroy();dom.window.close();});
  return {dom,a,b,calls,errors,config,get navigation(){return navigation;},bind,enqueue,done:()=>chain,
    activate(owner){active=owner;navigation.sync();},key(key,options={},target=dom.window.document.body){const event=new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options});target.dispatchEvent(event);return event;}};
}

test('relative steps coalesce before execution and again while an earlier card is loading',async t=>{
  const f=fixture(t),gate=deferred(),seen=[];f.config.navigateQuestion=async(owner,id)=>{seen.push(id);await gate.promise;owner.questionId=id;};f.bind();
  f.navigation.step(1);await tick();f.navigation.step(1);f.navigation.step(1);f.navigation.step(-1);f.navigation.step(1);gate.resolve();await f.done();
  assert.deepEqual(seen,['b']);assert.equal(f.a.summaryShown,true);assert.deepEqual(f.calls.map(row=>row[0]),['summary','close']);
});

test('queued relative, outline and summary intents cannot target a different active pane',async t=>{
  const f=fixture(t),gate=deferred();f.enqueue(()=>gate.promise);f.navigation.step(1);f.navigation.jump(f.a,'c','part');f.navigation.summary(f.a);
  f.activate(f.b);gate.resolve();await f.done();assert.deepEqual(f.calls,[]);assert.equal(f.b.questionId,'a');
  await f.navigation.step(1);assert.deepEqual(f.calls,[['question',f.b,'b']]);
});

test('leaving and returning to the same pane does not revive old queued clicks',async t=>{
  const f=fixture(t),gate=deferred();f.enqueue(()=>gate.promise);f.navigation.step(1);f.navigation.jump(f.a,'c',null);f.navigation.summary(f.a);
  f.activate(f.b);f.activate(f.a);gate.resolve();await f.done();assert.deepEqual(f.calls,[]);
  await f.navigation.jump(f.a,'b','one');assert.deepEqual(f.calls,[['jump',f.a,'b','one'],['close']]);
});

test('history entry changes and returning to live practice fence intents on the same host pane',async t=>{
  const f=fixture(t),gate=deferred();f.a.view='history';f.a.historyQuestionId='a';f.a.historyEntry={id:'old',summary:{}};f.a.historyView={questions:f.a.collection.questions};f.navigation.sync();
  f.enqueue(()=>gate.promise);f.navigation.jump(f.a,'b','part');f.navigation.summary(f.a);f.a.historyEntry={id:'new',summary:{}};f.navigation.sync();
  f.navigation.step(1);f.a.view='practice';f.navigation.sync();gate.resolve();await f.done();assert.deepEqual(f.calls,[]);
});

test('execution uses current question order and clamps bounds without mounting missing cards',async t=>{
  const f=fixture(t),gate=deferred();f.enqueue(()=>gate.promise);f.navigation.step(100);f.a.collection.questions=[{id:'a'},{id:'last'}];f.a.exam={status:'in-progress'};gate.resolve();await f.done();
  assert.deepEqual(f.calls,[['question',f.a,'last']]);await f.navigation.step(1);assert.equal(f.calls.length,1);
  f.a.questionId='missing';await f.navigation.step(-1);assert.equal(f.calls.length,1);
});

test('save or edit-leave rejection remains visible through the original queue and permits retry',async t=>{
  const f=fixture(t),failure=Object.assign(new Error('请先保存或取消'),{code:'UNSAVED_EDITOR_CHANGES'});let attempts=0;
  f.config.navigateQuestion=async(owner,id)=>{attempts++;if(attempts===1)throw failure;owner.questionId=id;};f.bind();
  await assert.rejects(f.navigation.step(1),error=>error===failure);await f.done();assert.equal(f.a.questionId,'a');assert.deepEqual(f.errors,[failure]);
  await f.navigation.step(1);assert.equal(f.a.questionId,'b');assert.equal(attempts,2);
});

test('destroy and duplicate binding cancel queued intents and leave one set of native handlers',async t=>{
  const f=fixture(t),gate=deferred();f.enqueue(()=>gate.promise);f.navigation.step(1);const old=f.navigation;f.bind();old.destroy();gate.resolve();await f.done();assert.deepEqual(f.calls,[]);
  f.dom.window.document.getElementById('next').click();await f.done();assert.deepEqual(f.calls,[['question',f.a,'b']]);
  f.navigation.destroy();f.key('ArrowRight');f.dom.window.document.getElementById('next').click();await f.done();assert.equal(f.calls.length,1);
});

test('keyboard restrictions preserve drafting, rich text, input and dialog interactions',async t=>{
  const f=fixture(t),document=f.dom.window.document;
  f.a.draftMode=true;assert.equal(f.key('ArrowRight').defaultPrevented,false);f.a.draftMode=false;f.a.richtextFrame={};assert.equal(f.key('ArrowRight').defaultPrevented,false);f.a.richtextFrame=null;
  assert.equal(f.key('ArrowRight',{},document.querySelector('textarea')).defaultPrevented,false);document.querySelector('dialog').open=true;assert.equal(f.key('ArrowRight').defaultPrevented,false);document.querySelector('dialog').open=false;
  assert.equal(f.key('ArrowRight',{ctrlKey:true}).defaultPrevented,false);assert.equal(f.key('ArrowRight').defaultPrevented,true);await f.done();assert.deepEqual(f.calls,[['question',f.a,'b']]);
});

test('inactive, closed and empty panes cannot queue navigation or resurrect a disposed controller',async t=>{
  const f=fixture(t);await f.navigation.jump(f.b,'b',null);assert.deepEqual(f.calls,[]);f.a.closed=true;await f.navigation.step(1);assert.deepEqual(f.calls,[]);
  f.a.closed=false;f.a.collection.questions=[];await f.navigation.step(1);assert.deepEqual(f.calls,[]);f.activate(null);await f.navigation.step(1);assert.deepEqual(f.calls,[]);
  f.navigation.destroy();await f.navigation.jump(f.a,'b',null);await f.navigation.summary(f.a);await f.navigation.step(1);assert.deepEqual(f.calls,[]);
});

test('relative bounds preserve first/last questions, optional summary, negative and zero steps',async t=>{
  const f=fixture(t),ids=['a','b','c'];
  for(const [index,offset,summary,expected]of [[0,-1,false,null],[0,5,false,'c'],[2,1,false,null],[2,1,true,'summary'],[3,-1,true,'c'],[1,-4,false,'a'],[-1,1,true,null],[1,0,true,null]]){
    f.calls.length=0;f.a.summaryShown=index===3;f.a.view=index===3?'summary':'practice';f.a.exam=summary?null:{status:'in-progress'};f.a.questionId=ids[index]||'missing';f.navigation.sync();
    await f.navigation.step(offset);const action=f.calls.find(row=>row[0]!=='close');assert.equal(action?.[0]==='summary'?'summary':action?.[2]??null,expected);
  }
});
