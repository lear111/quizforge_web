import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPracticeSummary} from '../../web/practice/practice-summary.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,summary,options={}){
  const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});loadVueUi(dom);
  const container=dom.window.document.getElementById('root'),view=mountPracticeSummary(container,summary,options);t.after(()=>{view.destroy();dom.window.close();});
  return {container,view,node:className=>container.querySelector('.'+className)||undefined,async click(){container.querySelector('.practice-summary-finish')?.click();await tick();}};
}

test('pending review is displayed separately and cannot freeze an unfinished score',async t=>{
  let calls=0;const f=fixture(t,{score:2,maxScore:10,submittedCount:2,gradedCount:1,pendingCount:1,questionCount:3},{onFinish(){calls++;}});
  assert.equal(f.node('practice-summary-score-label').textContent,'已评分得分 / 总分');assert.equal(f.node('practice-summary-grading').textContent,'待评分 1 题');assert.equal(f.node('practice-summary-finish').disabled,true);
  await f.click();assert.equal(calls,0);
  f.view.update({score:4.5,maxScore:10,submittedCount:2,gradedCount:2,pendingCount:0,questionCount:3});assert.equal(f.node('practice-summary-finish').disabled,false);assert.equal(f.node('practice-summary-grading').hidden,true);
});

test('summary uses host totals including unanswered questions and history has no finish or restart action',t=>{
  const f=fixture(t,{score:1.5,maxScore:12,submittedCount:1,questionCount:5,finished:false},{readonly:true,onFinish:()=>assert.fail('history cannot finish'),onRestart:()=>assert.fail('history cannot restart')});
  assert.equal(f.node('practice-summary-earned').textContent,'1.5');
  assert.equal(f.node('practice-summary-maximum').textContent,'12');
  assert.equal(f.node('practice-summary-count').textContent,'已提交 1 题');
  assert.equal(f.node('practice-summary-counts').children[1].textContent,'未提交 4 题');
  assert.equal(f.node('practice-summary-finish'),undefined);
  f.view.update({score:0,maxScore:0,questionCount:0,submittedCount:0,finished:true});
  assert.equal(f.node('practice-summary-title').textContent,'练习结果');
  assert.equal(f.node('practice-summary-maximum').textContent,'0');
  f.view.destroy();assert.equal(f.container.children.length,0);
});

test('finish locks duplicate clicks, exposes failure, then consumes the persisted summary',async t=>{
  let reject,attempts=0;
  const before={score:2,maxScore:10,submittedCount:2,questionCount:5,finished:false};
  const f=fixture(t,before,{onFinish:summary=>{
    assert.equal(summary,before);attempts++;
    if(attempts===1)return new Promise((_,failure)=>{reject=failure;});
    return {...before,finished:true};
  }});
  const button=f.node('practice-summary-finish');
  const pending=f.click();await f.click();
  assert.equal(attempts,1);assert.equal(button.disabled,true);
  assert.equal(button.getAttribute('aria-busy'),'true');
  reject(new Error('保存失败'));await pending;await tick();
  assert.equal(button.disabled,false);assert.equal(f.node('practice-summary-error').hidden,false);
  assert.equal(f.node('practice-summary-error').textContent,'保存失败');
  await f.click();assert.equal(attempts,2);assert.equal(button.disabled,true);
  assert.equal(button.textContent,'练习已完成');assert.equal(f.node('practice-summary-error').hidden,true);
  await f.click();assert.equal(attempts,2);
});

test('transient completion never claims a saved history entry while permanent completion uses its history ID',async t=>{
  const before={score:2,maxScore:2,submittedCount:1,questionCount:1,finished:false},f=fixture(t,before,{history:false,onFinish:async()=>({...before,finished:true})});
  assert.match(f.node('practice-summary-note').textContent,/当前会话.*刷新或关闭页面/);await f.click();assert.match(f.node('practice-summary-note').textContent,/仅在当前会话/);assert.doesNotMatch(f.node('practice-summary-note').textContent,/保存到历史/);
  f.view.update({...before,finished:true,historyId:'saved-round'});assert.match(f.node('practice-summary-note').textContent,/已保存到历史记录/);
});

test('completion offers another round, locks duplicate clicks and allows retry after a restart error',async t=>{
  const before={score:1,maxScore:5,submittedCount:1,questionCount:5,finished:false};
  let finishes=0,restarts=0,reject;
  const f=fixture(t,before,{onFinish:async()=>{finishes++;return {...before,finished:true,historyId:'first-round'};},onRestart:summary=>{
    assert.equal(summary.finished,true);restarts++;
    if(restarts===1)return new Promise((_,failure)=>{reject=failure;});
    f.view.destroy();
  }});
  const button=f.node('practice-summary-finish');await f.click();
  assert.equal(finishes,1);assert.equal(button.textContent,'再练一次');assert.equal(button.disabled,false);
  const pending=f.click();await f.click();assert.equal(restarts,1);assert.equal(button.disabled,true);assert.equal(button.textContent,'正在开始…');
  reject(new Error('连接失败'));await pending;await tick();
  assert.equal(f.node('practice-summary-error').textContent,'连接失败');assert.equal(button.disabled,false);
  await f.click();assert.equal(restarts,2);assert.equal(finishes,1);assert.equal(f.container.children.length,0);
});

test('exam summary displays a locked result and never offers practice restart or finish',t=>{
  const f=fixture(t,{score:2,maxScore:3,submittedCount:2,questionCount:3,finished:true},{exam:true,readonly:true});
  assert.equal(f.node('practice-summary-title').textContent,'考试结果');
  assert.equal(f.node('practice-summary-score-label').textContent,'考试得分 / 总分');
  assert.match(f.node('practice-summary-note').textContent,/答案已锁定/);
  assert.equal(f.node('practice-summary-finish'),undefined);
});
