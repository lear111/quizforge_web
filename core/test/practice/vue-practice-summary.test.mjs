import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {mountPracticeSummary} from '../../web/practice/practice-summary.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(t,summary={},options={}){
  const dom=new JSDOM('<div id="root"><p id="sibling">宿主内容</p></div>',{runScripts:'outside-only'});loadVueUi(dom);
  const root=dom.window.document.getElementById('root'),view=mountPracticeSummary(root,summary,options);t.after(()=>{view.destroy();dom.window.close();});
  return {dom,root,view,node:name=>root.querySelector('.practice-summary-'+name),async click(){root.querySelector('button')?.click();await tick();}};
}

test('summary preserves six decimal places, clamps submitted counts and tolerates invalid numeric display fields',t=>{
  const f=fixture(t,{score:1.23456789,maxScore:10.5,questionCount:3.9,submittedCount:9,pendingCount:1.9});
  assert.equal(f.node('earned').textContent,'1.234568');assert.equal(f.node('maximum').textContent,'10.5');
  assert.deepEqual([...f.root.querySelectorAll('.practice-summary-count')].map(n=>n.textContent),['已提交 3 题','未提交 0 题']);assert.equal(f.node('grading').textContent,'待评分 1 题');
  f.view.update({score:Infinity,maxScore:'invalid',questionCount:-4,submittedCount:-2,pendingCount:-3});
  assert.equal(f.node('earned').textContent,'0');assert.equal(f.node('maximum').textContent,'0');assert.equal(f.node('grading').hidden,true);
  assert.deepEqual([...f.root.querySelectorAll('.practice-summary-count')].map(n=>n.textContent),['已提交 0 题','未提交 0 题']);
});

test('answered but unsubmitted work can finish and passes the original command/version object to the host',async t=>{
  const before={score:2,maxScore:9,questionCount:3,pendingCount:1,answeredUnsubmittedCount:1,roundId:'round',summaryVersion:'version',privateAnswer:'PRIVATE_ANSWER'},seen=[];
  const f=fixture(t,before,{onFinish:summary=>{seen.push(summary);return {...summary,finished:true,historyId:'history'};}});
  assert.equal(f.node('finish').disabled,false);assert.match(f.node('note').textContent,/部分题目待评分/);assert.doesNotMatch(f.root.textContent,/PRIVATE_ANSWER|version|round/);
  await f.click();assert.equal(seen[0],before);assert.match(f.node('note').textContent,/已保存到历史记录/);
});

test('completion and action errors remain pure text, and retry clears the previous error',async t=>{
  const gate=deferred();let calls=0;const html='<img src=x onerror=alert(1)>';
  const f=fixture(t,{completionPending:true,completionError:html},{onFinish(){calls++;if(calls===1)throw new Error(html);return gate.promise;}});
  assert.equal(f.node('note').textContent,html);assert.equal(f.root.querySelector('img'),null);await f.click();assert.equal(f.node('error').textContent,html);assert.equal(f.root.querySelector('img'),null);
  await f.click();assert.equal(f.node('error').hidden,true);assert.equal(f.node('finish').getAttribute('aria-busy'),'true');gate.resolve({finished:true});await tick();assert.equal(f.node('error').hidden,true);
});

test('external updates win over an older successful action response and keep the focused button',async t=>{
  const gate=deferred(),f=fixture(t,{score:1},{onFinish:()=>gate.promise,onRestart(){}}),button=f.node('finish');button.focus();await f.click();
  f.view.update({score:8,maxScore:10,finished:true,historyId:'new'});assert.equal(f.node('finish'),button);assert.equal(f.dom.window.document.activeElement,button);
  gate.resolve({score:2,finished:true});await tick();assert.equal(f.node('earned').textContent,'8');assert.equal(button.textContent,'再练一次');assert.equal(button.disabled,false);
});

test('host conflict refresh keeps the newer score while showing the retry error',async t=>{
  const f=fixture(t,{score:1},{onFinish(){f.view.update({score:6,maxScore:10});throw new Error('数据已更新，请重新确认');}});
  await f.click();assert.equal(f.node('earned').textContent,'6');assert.equal(f.node('error').textContent,'数据已更新，请重新确认');assert.equal(f.node('finish').disabled,false);
});

for(const reject of [false,true])test('destroy is idempotent and late action results cannot restore the old card: '+reject,async t=>{
  const gate=deferred(),f=fixture(t,{score:1},{onFinish:()=>gate.promise});await f.click();f.view.destroy();f.view.destroy();
  if(reject)gate.reject(new Error('late'));else gate.resolve({score:9,finished:true});await tick();f.view.update({score:20});
  assert.equal(f.node('card'),null);assert.equal(f.root.children.length,1);assert.equal(f.root.querySelector('#sibling').textContent,'宿主内容');
});

test('remount removes the old action and ignores a retained detached button',async t=>{
  let oldCalls=0,newCalls=0;const f=fixture(t,{}, {onFinish(){oldCalls++;}}),old=f.node('finish');
  const replacement=mountPracticeSummary(f.root,{score:5},{onFinish(){newCalls++;}});t.after(()=>replacement.destroy());old.click();await f.click();
  assert.equal(oldCalls,0);assert.equal(newCalls,1);assert.equal(f.root.querySelectorAll('.practice-summary-card').length,1);assert.equal(f.node('earned').textContent,'5');
});

test('a card removed outside its binding cannot execute actions',async t=>{
  let calls=0;const f=fixture(t,{}, {onFinish(){calls++;}}),card=f.node('card'),button=f.node('finish');card.remove();button.click();await tick();assert.equal(calls,0);
});

test('readonly history and exam never render command controls, including after updates',async t=>{
  for(const exam of [false,true]){
    let calls=0;const f=fixture(t,{score:2,pendingCount:1,finished:true},{readonly:true,exam,onFinish(){calls++;},onRestart(){calls++;}});
    f.view.update({score:3,finished:false});await f.click();assert.equal(f.node('finish'),null);assert.equal(calls,0);assert.match(f.node('note').textContent,exam?/答案已锁定/:/只读历史/);
  }
});

test('missing callbacks and a pending grade cannot be bypassed by synthetic button events',async t=>{
  let calls=0;const f=fixture(t,{pendingCount:1},{onFinish(){calls++;}});f.node('finish').dispatchEvent(new f.dom.window.MouseEvent('click',{bubbles:true}));await tick();assert.equal(calls,0);
  f.view.update({finished:true});assert.equal(f.node('finish').disabled,true);f.node('finish').dispatchEvent(new f.dom.window.MouseEvent('click',{bubbles:true}));await tick();assert.equal(calls,0);
});

test('the original mutable host summary is not made reactive or exposed as a Vue display object',async t=>{
  const summary={score:2,privateAnswer:'ANSWER_NOT_FOR_VIEW',question:{text:'QUESTION_NOT_FOR_VIEW'}},f=fixture(t,summary);summary.score=7;await tick();
  assert.equal(f.node('earned').textContent,'2');assert.doesNotMatch(f.root.textContent,/ANSWER_NOT_FOR_VIEW|QUESTION_NOT_FOR_VIEW/);
  f.view.update(summary);assert.equal(f.node('earned').textContent,'7');assert.equal(f.root.querySelector('#sibling').textContent,'宿主内容');
});
