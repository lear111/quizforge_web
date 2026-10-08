import test from 'node:test';
import assert from 'node:assert/strict';
import {navigateOutlineTarget} from '../web/outline-navigation.js';
import {createHistoryView} from '../web/history-view.js';

const rows=[{id:'parent',outlineItems:[{id:'b',label:'2'},{id:'a',label:'1'}]},{id:'ordinary'}];
function fixture(view='practice'){
  const calls=[],pane={view,questionId:'parent',historyQuestionId:'parent',collection:{questions:rows},historyView:{questions:rows},node:{inert:true},plugin:{async navigateOutline(id){calls.push(['focus',id,pane.node.inert]);}}};
  const options={async navigateQuestion(pane,id){calls.push(['parent',id]);pane.summaryShown=false;if(view==='history')pane.historyQuestionId=id;else pane.questionId=id;},renderOutline(){calls.push(['render']);}};
  return {pane,calls,options};
}

for(const view of ['practice','edit','history'])test(`same-parent child navigation reuses its iframe in ${view}`,async()=>{
  const f=fixture(view),plugin=f.pane.plugin;
  await navigateOutlineTarget(f.pane,'parent','b',f.options);
  await navigateOutlineTarget(f.pane,'parent','a',f.options);
  assert.equal(f.pane.plugin,plugin);assert.equal(f.pane.outlineItemId,'a');
  assert.deepEqual(f.calls,[['focus','b',false],['render'],['focus','a',false],['render']]);
});

test('another parent is opened and ready before child focus',async()=>{
  const f=fixture();f.pane.questionId='ordinary';
  f.options.navigateQuestion=async(pane,id)=>{f.calls.push(['parent',id]);await Promise.resolve();pane.questionId=id;pane.node.inert=true;};
  await navigateOutlineTarget(f.pane,'parent','b',f.options);
  assert.deepEqual(f.calls,[['parent','parent'],['focus','b',false],['render']]);
});

test('summary and suspended views restore their parent before navigating',async()=>{
  for(const summary of [true,false]){
    const f=fixture();if(summary)f.pane.summaryShown=true;else f.pane.plugin=null;
    const navigate=f.options.navigateQuestion;
    f.options.navigateQuestion=async(pane,id)=>{await navigate(pane,id);pane.plugin={async navigateOutline(id){f.calls.push(['restored',id]);}};};
    await navigateOutlineTarget(f.pane,'parent','a',f.options);
    assert.deepEqual(f.calls,[['parent','parent'],['restored','a'],['render']]);
  }
});

test('unknown IDs, missing hooks and failed focus preserve previous selection',async()=>{
  const f=fixture();f.pane.outlineItemId='b';
  await assert.rejects(navigateOutlineTarget(f.pane,'parent','missing',f.options),/没有对应位置/);
  await assert.rejects(navigateOutlineTarget(f.pane,'missing','a',f.options),/没有对应位置/);
  assert.deepEqual(f.calls,[]);
  f.pane.plugin.navigateOutline=async()=>{throw new Error('该小题已从草稿删除');};
  await assert.rejects(navigateOutlineTarget(f.pane,'parent','a',f.options),/草稿删除/);
  assert.equal(f.pane.outlineItemId,'b');assert.deepEqual(f.calls,[]);
});

test('stale or closed page cannot apply a late child acknowledgement',async()=>{
  const f=fixture();f.pane.outlineItemId='b';
  f.pane.plugin.navigateOutline=async()=>{f.pane.plugin={};};
  await assert.rejects(navigateOutlineTarget(f.pane,'parent','a',f.options),/页面已切换/);
  assert.equal(f.pane.outlineItemId,'b');
  f.pane.closed=true;
  await assert.rejects(navigateOutlineTarget(f.pane,'parent','a',f.options),/标签页已关闭/);
});

test('ordinary parent navigation needs no child hook and clears selection',async()=>{
  const f=fixture();f.pane.plugin={};f.pane.outlineItemId='a';
  await navigateOutlineTarget(f.pane,'ordinary',null,f.options);
  assert.equal(f.pane.outlineItemId,null);assert.deepEqual(f.calls,[['parent','ordinary'],['render']]);
});

test('history navigation uses frozen child order rather than the current bank',async()=>{
  const history=createHistoryView({page:{html:'',script:'',style:''},collection:{questions:rows},questions:rows.map(row=>({payload:{question:{id:row.id,title:row.id},state:{status:'unanswered'}}}))});
  const f=fixture('history');f.pane.historyView=history;f.pane.collection.questions=[{id:'parent',outlineItems:[{id:'new',label:'新小题'}]}];
  assert.deepEqual(history.questions[0].outlineItems.map(item=>item.id),['b','a']);
  await navigateOutlineTarget(f.pane,'parent','a',f.options);
  await assert.rejects(navigateOutlineTarget(f.pane,'parent','new',f.options),/没有对应位置/);
  assert.equal(history.questions.length,2);assert.equal(Object.keys(history.states).length,2);
});
