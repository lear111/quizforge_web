import test from 'node:test';
import assert from 'node:assert/strict';
import {createExtensionRouter} from '../web/extension-requests.js';
import {contextFor,navigationIndex,visibleQuestions} from '../web/practice-context.js';

function fixture(){
  const calls=[],scheduled=[];
  const record=name=>(...args)=>{calls.push([name,...args]);return Promise.resolve({ok:true});};
  const route=createExtensionRouter({readResource:record('read'),uploadResource:record('upload'),loadSdk:record('sdk'),save:record('save'),ai:record('ai'),navigate:record('navigate'),summary:record('summary'),schedule:fn=>scheduled.push(fn)});
  return {route,calls,scheduled,pane:{view:'practice',questionId:'q1',collection:{questions:[{id:'q1'},{id:'q2'}]},pageAssets:{dependencies:[{id:'rich',version:'1'}]}}};
}
test('history can read declared resources but cannot grade, write, upload or navigate',async()=>{
  const {route,pane,calls}=fixture();pane.view='history';pane.historyQuestion={page:pane.pageAssets};
  for(const [method,args]of [['ai-grade',{}],['save',{purpose:'submit',data:{answer:{}}}],['resource-put',{}],['action',{action:'next'}]])assert.equal((await route(pane,method,args)).error.code,'READ_ONLY');
  assert.equal((await route(pane,'sdk-editor',{id:'rich',version:'2'})).error.code,'SDK_UNAVAILABLE');
  await route(pane,'sdk-editor',{id:'rich',version:'1'});await route(pane,'resource-get',{id:'image'});
  assert.deepEqual(calls.map(call=>call[0]),['sdk','read']);
});
test('save and AI remain host-owned; navigation replies before scheduling a flush',async()=>{
  const {route,pane,calls,scheduled}=fixture();
  assert.equal((await route(pane,'save',{purpose:'submit',data:{}})).error.code,'INVALID_REQUEST');
  await route(pane,'save',{purpose:'review',data:{review:{score:2.5}}});await route(pane,'ai-grade',{force:true});
  assert.equal((await route(pane,'action',{action:'next'})).data.status,'navigating');
  assert.deepEqual(calls.map(call=>call[0]),['save','ai']);scheduled.shift()();assert.equal(calls.at(-1)[0],'navigate');
  pane.questionId='q2';await route(pane,'action',{action:'next'});scheduled.shift()();assert.equal(calls.at(-1)[0],'summary');
});
test('history context is immutable and summary navigation retains original question order',()=>{
  const pane={kind:'bank',view:'history',collection:{questions:[{id:'q1'}]},historyQuestionId:'q2',historyView:{questions:[{id:'q2'},{id:'q1'}]},historyQuestion:{payload:{question:{id:'q2'},state:{status:'submitted',answer:{},result:{}},capabilities:{canReview:true,canAiGrade:true}}}};
  assert.deepEqual(visibleQuestions(pane).map(q=>q.id),['q2','q1']);assert.equal(navigationIndex(pane),0);
  const context=contextFor(pane);assert.equal(context.mode,'history');assert.equal(context.capabilities.canAiGrade,false);assert.equal(context.capabilities.canReview,false);
  pane.summaryShown=true;assert.equal(navigationIndex(pane),2);pane.view='history-deleted';assert.deepEqual(visibleQuestions(pane),[]);
});

test('collection controls preserve answer autosave without whiteboard and reject disabled editing uploads',async()=>{
  const {route,pane,calls}=fixture();pane.collection.features={editing:false,whiteboard:false,history:false};
  await route(pane,'save',{purpose:'draft',data:{answer:{text:'unfinished answer'}}});assert.equal(calls.at(-1)[0],'save');assert.equal(calls.at(-1)[2],'draft');
  pane.view='edit';assert.equal((await route(pane,'resource-put',{})).error.code,'FEATURE_DISABLED');pane.collection.features.editing=true;await route(pane,'resource-put',{});assert.equal(calls.at(-1)[0],'upload');
  pane.view='practice';pane.kind='extension';pane.payload={question:{id:'q1'},state:{status:'unanswered'}};const context=contextFor(pane);assert.equal(context.capabilities.canSave,true);assert.equal(context.capabilities.canSubmit,true);assert.equal(context.capabilities.canWhiteboard,false);assert.equal(context.capabilities.canHistory,false);assert.equal(context.capabilities.canEdit,true);
});
