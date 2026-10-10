import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createQuestionCache} from '../web/question-cache.js';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const restart=source.slice(source.indexOf('async function restartPractice('),source.indexOf('\nconst historyPath='));
function fixture(t,{history=true}={}){
  const summary={finished:true,roundId:'old-round',summaryVersion:'completed-version'};
  const pane={key:'bank:test',kind:'bank',id:'test',view:'summary',node:{inert:false},ink:{clear(){this.cleared=true;}},draftMode:true,historyRecords:[{id:'old-round'}],finishRequest:{requestId:'old-finish'},summaryCard:{update(value){pane.scoreSummary=value;}},closed:false};
  const questionsCache=createQuestionCache({schedule:null});t.after(()=>questionsCache.clear());
  questionsCache.set('bank:test:a',{state:{status:'submitted'}});questionsCache.set('bank:test:b',{state:{status:'draft'}});questionsCache.set('bank:other:a',{state:{status:'submitted'}});
  const calls=[],loads=[],statuses=[];let failPost=false,failGet=false,failLoad=false,conflict=false,tail=Promise.resolve();
  const collection={questions:[{id:'a'},{id:'b'}],states:{a:{status:'unanswered'},b:{status:'unanswered'}},features:{history}};
  const sandbox={pendingWrites:0,clearTimeout,questionsCache,makeRequestId:()=> 'restart-request',collectionPath:(kind,id)=>`/collections/${kind}/${id}`,updateChrome(){},renderOutline(){},saveStatus:(...args)=>statuses.push(args),transitionTo:fn=>{const run=tail.then(fn);tail=run.catch(()=>{});return run.finally(()=>{pane.node.inert=false;});},request:async(path,options)=>{
    calls.push({path,body:options&&JSON.parse(options.body)});
    if(options){if(conflict)throw Object.assign(new Error('数据冲突'),{status:409});if(failPost){failPost=false;throw new Error('连接失败');}return {restarted:true};}
    if(path.endsWith('/summary'))return {finished:false,roundId:'new-round',summaryVersion:'updated-version'};
    if(failGet){failGet=false;throw new Error('读取失败');}return collection;
  },showQuestion:async(target,qid,options)=>{loads.push({qid,...options});if(failLoad){failLoad=false;throw new Error('题卡加载失败');}target.collection=options.collection;target.questionId=qid;target.view='practice';}};
  vm.runInNewContext(restart+'\nglobalThis.restartPractice=restartPractice;',sandbox);
  return {pane,summary,sandbox,calls,loads,statuses,questionsCache,collection,restart:()=>sandbox.restartPractice(pane,summary),failNextPost:()=>{failPost=true;},failNextGet:()=>{failGet=true;},failNextLoad:()=>{failLoad=true;},conflict:()=>{conflict=true;}};
}

test('another round invalidates only its question cache, returns to the first question and leaves history browsing read-only',async t=>{
  const f=fixture(t);await f.restart();
  assert.equal(f.calls.filter(call=>call.body).length,1);assert.equal(f.calls[0].path,'/collections/bank/test/restart');
  assert.equal(f.loads[0].qid,'a');assert.equal(f.loads[0].collection,f.collection);assert.equal(f.pane.view,'practice');assert.equal(f.pane.draftMode,false);assert.equal(f.pane.ink.cleared,true);
  assert.equal(f.questionsCache.get('bank:test:a'),null);assert.equal(f.questionsCache.get('bank:test:b'),null);assert.notEqual(f.questionsCache.get('bank:other:a'),null);
  assert.equal(f.sandbox.pendingWrites,0);assert.equal(f.pane.node.inert,false);assert.equal(f.pane.restartRequest,null);assert.equal(f.pane.finishRequest,null);
  f.pane.view='history';await f.restart();assert.equal(f.calls.length,2);
});

test('network retry reuses the same command; load retry cannot reset answers after the new round started',async t=>{
  const f=fixture(t,{history:false});f.failNextPost();await assert.rejects(f.restart(),/连接失败/);
  const first=f.calls[0].body;f.failNextLoad();await assert.rejects(f.restart(),/题卡加载失败/);
  assert.deepEqual(f.calls[1].body,first);assert.equal(f.pane.restartApplied,true);
  await f.restart();assert.equal(f.calls.filter(call=>call.body).length,2);assert.equal(f.pane.view,'practice');assert.equal(f.sandbox.pendingWrites,0);
});

test('a stale reset refreshes the score card without discarding cached work or drafts',async t=>{
  const f=fixture(t);f.conflict();await assert.rejects(f.restart(),/练习数据已更新/);
  assert.equal(f.pane.scoreSummary.finished,false);assert.equal(f.pane.restartRequest,null);assert.equal(f.pane.ink.cleared,undefined);assert.notEqual(f.questionsCache.get('bank:test:a'),null);assert.equal(f.loads.length,0);assert.equal(f.pane.node.inert,false);
});
