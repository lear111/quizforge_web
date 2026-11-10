import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindExamMode} from '../../web/exam/exam-mode.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(t,options={}){
  const dom=new JSDOM('<div class="document-actions"></div>',{runScripts:'outside-only'}),document=dom.window.document;
  loadVueUi(dom);dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
  const calls=[],errors=[],opened=[],refreshed=[];
  let current={kind:'bank',id:'b',view:'practice',collection:{}},clock=10000,poll;
  const real=globalThis.setInterval;globalThis.setInterval=callback=>{poll=callback;return 0;};
  let controls;
  try{controls=bindExamMode({document,active:()=>current,now:()=>clock,collectionPath:(kind,id)=>`/${kind}/${id}`,makeRequestId:()=> 'request',flush:async()=>{},request:async(path,options)=>{calls.push([path,options]);return options?{id:'attempt'}:{records:[]};},open:async(...args)=>opened.push(args),refresh:async(...args)=>refreshed.push(args),onError:error=>errors.push(error),...options});}
  finally{globalThis.setInterval=real;}
  t.after(()=>{controls.destroy();dom.window.close();});
  const node=selector=>document.querySelector(selector);
  return {dom,document,controls,calls,errors,opened,refreshed,node,poll,advance:ms=>{clock+=ms;},set pane(value){current=value;controls.sync();},get pane(){return current;},async start(){node('#exam-start').click();await tick();},submit(){node('.exam-dialog form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));}};
}

test('duplicate create is locked immediately and a failed request retains values and request ID for retry',async t=>{
  const gate=deferred(),posts=[];let fail=true;
  const f=fixture(t,{request:async(_path,options)=>{if(!options)return {records:[]};posts.push(JSON.parse(options.body));if(fail){await gate.promise;throw Error('<b>断开</b>');}return {id:'attempt'};}});
  await f.start();const input=f.node('#exam-duration');input.value='90';input.dispatchEvent(new f.dom.window.Event('input'));
  f.submit();f.submit();assert.equal(posts.length,1);assert.equal(f.node('button[type=submit]').disabled,true);
  gate.resolve();await tick();assert.equal(input.value,'90');assert.equal(f.node('.exam-error').textContent,'<b>断开</b>');assert.equal(f.node('.exam-error b'),null);
  fail=false;f.submit();await tick();assert.deepEqual(posts,[{requestId:'request',durationMinutes:90},{requestId:'request',durationMinutes:90}]);assert.deepEqual(f.opened,[['exam','attempt']]);
});

test('duration validation rejects out of range and fractional values before creating attempts',async t=>{
  const f=fixture(t);await f.start();
  for(const value of ['0','1441','1.5']){const input=f.node('#exam-duration');input.value=value;input.dispatchEvent(new f.dom.window.Event('input'));f.submit();await tick();assert.match(f.node('.exam-error').textContent,/1–1440/);}
  assert.equal(f.calls.filter(([,options])=>options?.method==='POST').length,0);
});

for(const phase of ['flush','list','create','delete-confirm','delete-request','poll'])test('disposal prevents late '+phase+' effects and detached controls cannot remount',async t=>{
  const gate=deferred(),calls=[];let flushes=0;
  const f=fixture(t,{flush:async()=>{flushes++;if(phase==='flush')await gate.promise;},request:async(path,options)=>{
    calls.push([path,options]);if(phase==='list'||phase==='poll'||phase==='create'&&options?.method==='POST'||phase==='delete-request'&&options?.method==='DELETE')return gate.promise;
    return {records:[{id:'old',status:'in-progress',startedAt:'2026-11-09T00:00:00Z'}]};
  }});
  const oldStart=f.node('#exam-start');
  if(phase==='poll'){
    f.pane={kind:'exam',id:'attempt',view:'practice',exam:{id:'attempt',status:'in-progress',startedAt:new Date(0).toISOString()},collection:{}};f.poll();await tick();
  }else{
    await f.start();
    if(phase==='create')f.submit();
    if(phase.startsWith('delete')){f.node('.exam-record-delete').click();if(phase==='delete-request'){f.node('.danger-button').click();await tick();}}
  }
  f.controls.destroy();f.controls.destroy();oldStart.click();gate.resolve({id:'attempt',records:[]});await tick();
  assert.equal(f.node('#exam-controls-root'),null);assert.equal(f.node('.exam-dialog'),null);assert.equal(f.node('.exam-delete-dialog'),null);
  assert.deepEqual(f.opened,[]);assert.deepEqual(f.errors,[]);assert.deepEqual(f.refreshed,[]);assert.ok(flushes<=1);
  if(phase==='delete-confirm')assert.equal(calls.some(([,options])=>options?.method==='DELETE'),false);
});

test('poll errors stay with their attempt and destroyed timers cannot start more requests',async t=>{
  const f=fixture(t,{request:async()=>{throw Error('offline');}});
  f.pane={kind:'exam',id:'a',view:'practice',exam:{id:'a',status:'in-progress',startedAt:new Date(0).toISOString()},collection:{}};
  await f.poll();assert.match(f.node('#exam-status').textContent,/连接中断/);
  f.pane={kind:'exam',id:'b',view:'practice',exam:{id:'b',status:'completed'},collection:{}};assert.equal(f.node('#exam-status').textContent,'考试已完成');
  f.controls.destroy();await f.poll();assert.equal(f.node('#exam-status'),null);
});

test('grading retry skips a second flush and completed/history controls stay hidden',async t=>{
  let flushes=0;const f=fixture(t,{flush:async()=>flushes++});
  f.pane={kind:'exam',id:'attempt',view:'practice',exam:{id:'attempt',status:'grading',gradingErrors:['retry']},collection:{}};
  assert.equal(f.node('#exam-submit').textContent,'重试评分');f.node('#exam-submit').click();await tick();assert.equal(flushes,0);assert.equal(f.calls.length,1);
  for(const [status,view]of [['completed','practice'],['grading','history']]){f.pane={...f.pane,view,exam:{...f.pane.exam,status}};assert.equal(f.node('#exam-submit').hidden,true);f.node('#exam-submit').click();await tick();}
  assert.equal(f.calls.length,1);
});
