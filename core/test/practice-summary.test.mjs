import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPracticeSummary} from '../web/practice-summary.js';

function fixture(summary,options={}){
  const document={createElement:tag=>new Element(tag)};
  class Element{
    constructor(tag){this.tagName=tag;this.ownerDocument=document;this.children=[];this.listeners=new Map();this.attributes={};this.className='';this.textContent='';this.classList={toggle:()=>{}};}
    append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
    remove(){this.parent.children=this.parent.children.filter(node=>node!==this);}
    setAttribute(name,value){this.attributes[name]=value;}
    addEventListener(name,handler){this.listeners.set(name,handler);}
    removeEventListener(name,handler){if(this.listeners.get(name)===handler)this.listeners.delete(name);}
    query(className){return this.children.flatMap(node=>[node,...node.descendants()]).find(node=>node.className===className);}
    descendants(){return this.children.flatMap(node=>[node,...node.descendants()]);}
    click(){return this.listeners.get('click')?.();}
  }
  const container=new Element('div'),view=mountPracticeSummary(container,summary,options);
  return {container,view,node:className=>container.query(className)};
}

test('pending review is displayed separately and cannot freeze an unfinished score',async()=>{
  let calls=0;const f=fixture({score:2,maxScore:10,submittedCount:2,gradedCount:1,pendingCount:1,questionCount:3},{onFinish(){calls++;}});
  assert.equal(f.node('practice-summary-score-label').textContent,'已评分得分 / 总分');assert.equal(f.node('practice-summary-grading').textContent,'待评分 1 题');assert.equal(f.node('practice-summary-finish').disabled,true);
  await f.node('practice-summary-finish').click();assert.equal(calls,0);
  f.view.update({score:4.5,maxScore:10,submittedCount:2,gradedCount:2,pendingCount:0,questionCount:3});assert.equal(f.node('practice-summary-finish').disabled,false);assert.equal(f.node('practice-summary-grading').hidden,true);
});

test('summary uses host totals including unanswered questions and history has no finish or restart action',()=>{
  const f=fixture({score:1.5,maxScore:12,submittedCount:1,questionCount:5,finished:false},{readonly:true,onFinish:()=>assert.fail('history cannot finish'),onRestart:()=>assert.fail('history cannot restart')});
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

test('finish locks duplicate clicks, exposes failure, then consumes the persisted summary',async()=>{
  let reject,attempts=0;
  const before={score:2,maxScore:10,submittedCount:2,questionCount:5,finished:false};
  const f=fixture(before,{onFinish:summary=>{
    assert.equal(summary,before);attempts++;
    if(attempts===1)return new Promise((_,failure)=>{reject=failure;});
    return {...before,finished:true};
  }});
  const button=f.node('practice-summary-finish');
  const pending=button.click();await button.click();
  assert.equal(attempts,1);assert.equal(button.disabled,true);
  assert.equal(button.attributes['aria-busy'],'true');
  reject(new Error('保存失败'));await pending;
  assert.equal(button.disabled,false);assert.equal(f.node('practice-summary-error').hidden,false);
  assert.equal(f.node('practice-summary-error').textContent,'保存失败');
  await button.click();assert.equal(attempts,2);assert.equal(button.disabled,true);
  assert.equal(button.textContent,'练习已完成');assert.equal(f.node('practice-summary-error').hidden,true);
  await button.click();assert.equal(attempts,2);
});

test('transient completion never claims a saved history entry while permanent completion uses its history ID',async()=>{
  const before={score:2,maxScore:2,submittedCount:1,questionCount:1,finished:false},f=fixture(before,{history:false,onFinish:async()=>({...before,finished:true})});
  assert.match(f.node('practice-summary-note').textContent,/当前会话.*刷新或关闭页面/);await f.node('practice-summary-finish').click();assert.match(f.node('practice-summary-note').textContent,/仅在当前会话/);assert.doesNotMatch(f.node('practice-summary-note').textContent,/保存到历史/);
  f.view.update({...before,finished:true,historyId:'saved-round'});assert.match(f.node('practice-summary-note').textContent,/已保存到历史记录/);
});

test('completion offers another round, locks duplicate clicks and allows retry after a restart error',async()=>{
  const before={score:1,maxScore:5,submittedCount:1,questionCount:5,finished:false};
  let finishes=0,restarts=0,reject;
  const f=fixture(before,{onFinish:async()=>{finishes++;return {...before,finished:true,historyId:'first-round'};},onRestart:summary=>{
    assert.equal(summary.finished,true);restarts++;
    if(restarts===1)return new Promise((_,failure)=>{reject=failure;});
    f.view.destroy();
  }});
  const button=f.node('practice-summary-finish');await button.click();
  assert.equal(finishes,1);assert.equal(button.textContent,'再练一次');assert.equal(button.disabled,false);
  const pending=button.click();await button.click();assert.equal(restarts,1);assert.equal(button.disabled,true);assert.equal(button.textContent,'正在开始…');
  reject(new Error('连接失败'));await pending;
  assert.equal(f.node('practice-summary-error').textContent,'连接失败');assert.equal(button.disabled,false);
  await button.click();assert.equal(restarts,2);assert.equal(finishes,1);assert.equal(f.container.children.length,0);
});
