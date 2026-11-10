import test from 'node:test';
import assert from 'node:assert/strict';
import {contextFor,hasScoreSummary,canEditCollection} from '../../web/practice/practice-context.js';
import {createExtensionRouter} from '../../web/bridge/extension-requests.js';
import {canStartExam,examTimeLabel,bindExamMode} from '../../web/exam/exam-mode.js';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
function page(html){const dom=new JSDOM(html,{runScripts:'outside-only'});loadVueUi(dom);return dom;}

const pane=status=>({kind:'exam',id:'attempt',view:'practice',exam:{id:'attempt',status},collection:{features:{editing:true,whiteboard:true,history:true},questions:[{id:'q1'}]},payload:{question:{id:'q1',data:{}},state:{status:'draft',answer:{text:'answer'},result:null},capabilities:{canReview:true,canAiGrade:true}}});
test('bank exam entry defaults on and only an explicit false hides it',()=>{
  assert.equal(canStartExam({kind:'bank',view:'practice',collection:{features:{exam:true}}}),true);
  assert.equal(canStartExam({kind:'bank',view:'practice',collection:{}}),true);
  assert.equal(canStartExam({kind:'bank',view:'practice',collection:{features:{}}}),true);
  assert.equal(canStartExam({kind:'development-bank',view:'practice',collection:{features:{editing:false}}}),true);
  assert.equal(canStartExam({kind:'bank',view:'practice',collection:{features:{exam:false}}}),false);
  assert.equal(canStartExam({kind:'bank',view:'practice'}),false);
  assert.equal(canStartExam(pane('in-progress')),false);
});
test('exam keeps answer saving independent from submission and hides scoring until hand-in',()=>{
  const p=pane('in-progress'),context=contextFor(p);assert.equal(context.mode,'exam');assert.equal(context.capabilities.canSave,true);assert.equal(context.capabilities.canSubmit,false);assert.equal(context.capabilities.canAiGrade,false);assert.equal(context.capabilities.canReview,false);assert.equal(hasScoreSummary(p),false);assert.equal(canEditCollection(p),false);
  p.exam.status='grading';assert.equal(contextFor(p).capabilities.canSave,false);assert.equal(contextFor(p).capabilities.canReview,true);assert.equal(contextFor(p).capabilities.canAiGrade,true);assert.equal(hasScoreSummary(p),true);
  p.exam.status='completed';assert.equal(contextFor(p).capabilities.canReview,false);assert.equal(contextFor(p).capabilities.canRetry,false);
});
test('extension requests cannot bypass the exam gate, but draft save and later manual grading work',async()=>{
  const calls=[],route=createExtensionRouter({save:async(p,action,data)=>{calls.push(action);return {ok:true};},ai:async()=>{calls.push('ai');return {ok:true};}}),p=pane('in-progress');
  assert.equal((await route(p,'save',{purpose:'draft',data:{answer:{text:'hello'}}})).ok,true);
  for(const [method,args] of [['save',{purpose:'submit',data:{answer:{}}}],['save',{purpose:'review',data:{review:{score:1}}}],['action',{action:'retry'}],['ai-grade',{}]])assert.equal((await route(p,method,args)).error.code,'EXAM_ACTION_DISABLED');
  p.exam.status='grading';assert.equal((await route(p,'save',{purpose:'review',data:{review:{score:1}}})).ok,true);assert.equal((await route(p,'ai-grade',{})).ok,true);assert.equal((await route(p,'save',{purpose:'draft',data:{answer:{}}})).ok,false);assert.deepEqual(calls,['draft','review','ai']);
});
test('clock shows remaining time without extending past zero, or elapsed time when unlimited',()=>{
  const start=Date.parse('2026-10-10T10:00:00Z'),exam={startedAt:new Date(start).toISOString(),deadline:new Date(start+60000).toISOString()};assert.equal(examTimeLabel(exam,start+5000),'剩余 0:55');assert.equal(examTimeLabel(exam,start+90000),'剩余 0:00');exam.deadline=null;assert.equal(examTimeLabel(exam,start+90000),'已用 1:30');
});

test('deadline locks the answer and whiteboard immediately and polls without the normal delay',async t=>{
 const dom=page('<div class="document-actions"></div><div id="frame"></div>');t.after(()=>dom.window.close());
 const start=Date.parse('2026-10-12T10:00:00Z'),target=pane('in-progress'),readOnly=[];let clock=start,poll,requests=0,deadlines=0;
 target.exam={...target.exam,startedAt:new Date(start).toISOString(),deadline:new Date(start+1000).toISOString()};target.frameHost=dom.window.document.getElementById('frame');target.whiteboard={setReadOnly:value=>readOnly.push(value)};
 const realInterval=globalThis.setInterval;globalThis.setInterval=callback=>{poll=callback;return 0;};
 let ui;try{ui=bindExamMode({document:dom.window.document,active:()=>target,now:()=>clock,request:async()=>{requests++;return {...target.exam,serverTime:new Date(clock).toISOString()};},refresh:async()=>{},collectionPath:()=>'/exam',onDeadline:()=>deadlines++,onError:assert.fail});}finally{globalThis.setInterval=realInterval;}
 t.after(()=>ui.destroy());await poll();assert.equal(requests,1);
 clock=start+1000;await poll();assert.equal(requests,2,'Deadline bypasses the three-second polling interval');
 assert.equal(target.frameHost.inert,true);assert.equal(contextFor(target).capabilities.canSave,false);assert.equal(contextFor(target).capabilities.canWhiteboard,false);
 assert.equal(hasScoreSummary(target),false);assert.equal(readOnly.at(-1),true);assert.equal(deadlines,1);
 assert.match(dom.window.document.getElementById('exam-status').textContent,/时间已到/);ui.sync();assert.equal(deadlines,1);
 target.exam.status='grading';ui.sync();assert.equal(target.frameHost.inert,false);assert.equal(contextFor(target).capabilities.canReview,true);
});

test('countdown displays the final partial second as one instead of reaching zero before the deadline',()=>{
 const exam={deadline:new Date(1000).toISOString()};assert.equal(examTimeLabel(exam,900),'剩余 0:01');assert.equal(examTimeLabel(exam,1000),'剩余 0:00');
});
test('host starts an unlimited exam, flushes before hand-in and returns to the original practice',async t=>{
  const dom=page('<div class="document-actions"></div>'),document=dom.window.document,calls=[];
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const previous=globalThis.confirm;globalThis.confirm=()=>true;t.after(()=>{globalThis.confirm=previous;});
  let current={kind:'bank',id:'b',view:'practice',collection:{features:{exam:true}}};
  const exam={id:'e',bankKind:'bank',bankId:'b',status:'in-progress',startedAt:new Date().toISOString(),deadline:null,serverTime:new Date().toISOString()};
  const controls=bindExamMode({document,active:()=>current,makeRequestId:()=> 'host-request',collectionPath:(kind,id)=>`/api/collections/${kind}/${id}`,flush:async()=>{calls.push('flush');},request:async(path,options)=>{calls.push(path);if(path.endsWith('/exams')&&!options)return {records:[]};if(path.endsWith('/exams')){assert.equal(JSON.parse(options.body).durationMinutes,null);return exam;}return {...exam,status:'completed'};},open:async(kind,id)=>{calls.push(`open:${kind}:${id}`);current=kind==='exam'?{...pane('in-progress'),id,exam}:{kind,id,view:'practice',collection:{features:{exam:true}}};},refresh:async(p,next)=>{p.exam=next;calls.push('refreshed');},onError:error=>{throw error;}});
  t.after(()=>{controls.destroy();dom.window.close();});const tick=()=>new Promise(resolve=>setImmediate(resolve));
  document.querySelector('#exam-start').click();await tick();const unlimited=document.querySelector('.exam-unlimited input');unlimited.checked=true;unlimited.dispatchEvent(new dom.window.Event('change'));document.querySelector('.exam-dialog form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await tick();
  assert.equal(current.kind,'exam');assert.equal(document.querySelector('#exam-start').hidden,true);assert.equal(document.querySelector('#exam-submit').hidden,false);
  document.querySelector('#exam-submit').click();await tick();assert.equal(current.exam.status,'completed');assert.deepEqual(calls.slice(-3),['flush','/api/collections/exam/e/exam','refreshed']);
  document.querySelector('#exam-return').click();await tick();assert.equal(current.kind,'bank');assert.equal(current.id,'b');
});

test('exam entry lists only unfinished attempts and grading issues, keeping both resumable',async t=>{
  const dom=page('<div class="document-actions"></div>'),document=dom.window.document,opened=[];
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const current={kind:'bank',id:'b',view:'practice',collection:{features:{exam:true}}};
  const controls=bindExamMode({document,active:()=>current,makeRequestId:()=> 'unused',collectionPath:(kind,id)=>`/api/collections/${kind}/${id}`,flush:async()=>{},request:async()=>({records:['completed','in-progress','grading'].map((status,i)=>({id:`e${i}`,status,startedAt:'2026-10-11T00:00:00Z'}))}),open:async(kind,id)=>opened.push([kind,id]),refresh:async()=>{},onError:error=>{throw error;}});
  t.after(()=>{controls.destroy();dom.window.close();});
  const tick=()=>new Promise(resolve=>setImmediate(resolve));document.querySelector('#exam-start').click();await tick();
  const buttons=[...document.querySelectorAll('.exam-record')];assert.equal(buttons.length,2);
  assert.match(buttons[0].textContent,/继续考试/);assert.match(buttons[1].textContent,/查看评分/);assert.doesNotMatch(document.querySelector('.exam-dialog').textContent,/查看成绩/);
  buttons[0].click();await tick();document.querySelector('#exam-start').click();await tick();document.querySelectorAll('.exam-record')[1].click();await tick();assert.deepEqual(opened,[['exam','e1'],['exam','e2']]);
});

test('a created exam that fails to open reports the error outside the closed settings dialog',async t=>{
  const dom=page('<div class="document-actions"></div>'),document=dom.window.document,errors=[],requests=[],opened=[];
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const controls=bindExamMode({document,active:()=>({kind:'bank',id:'b',view:'practice',collection:{features:{exam:true}}}),makeRequestId:()=> 'create-once',collectionPath:(kind,id)=>`/api/collections/${kind}/${id}`,flush:async()=>{},request:async(path,options)=>{requests.push({path,options});return options?{id:'created-attempt'}:{records:[]};},open:async(kind,id)=>{opened.push([kind,id]);throw new Error('题卡加载失败');},refresh:async()=>{},onError:error=>errors.push(error)});
  t.after(()=>{controls.destroy();dom.window.close();});const tick=()=>new Promise(resolve=>setImmediate(resolve));
  document.querySelector('#exam-start').click();await tick();
  document.querySelector('.exam-dialog form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await tick();
  assert.equal(document.querySelector('.exam-dialog').open,false);assert.deepEqual(opened,[['exam','created-attempt']]);
  assert.equal(errors.length,1);assert.equal(errors[0].message,'题卡加载失败');assert.equal(requests.filter(call=>call.options?.method==='POST').length,1);
});

async function deletionFixture(t,{rows=[{id:'attempt',status:'in-progress',startedAt:'2026-10-11T02:00:00Z',durationMinutes:60}],remove=async()=>({deleted:'attempt'})}={}){
  const dom=page('<div class="document-actions"></div>'),document=dom.window.document,requests=[],opened=[];
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
  const controls=bindExamMode({document,active:()=>({kind:'bank',id:'b',view:'practice',collection:{features:{exam:true}}}),makeRequestId:()=> 'new-exam-request',collectionPath:(kind,id)=>`/api/collections/${kind}/${id}`,flush:async()=>{},request:async(path,options)=>{requests.push({path,options});if(!options)return {records:rows};return remove(path,options);},open:async(kind,id)=>opened.push([kind,id]),refresh:async()=>{},onError:error=>{throw error;}});
  t.after(()=>{controls.destroy();dom.window.close();});const tick=()=>new Promise(resolve=>setImmediate(resolve));
  document.querySelector('#exam-start').click();await tick();
  return {document,requests,opened,tick,remove:()=>document.querySelector('.exam-record-delete').click(),accept:()=>document.querySelector('.exam-delete-dialog .danger-button').click(),cancel:()=>document.querySelector('.exam-delete-dialog .dialog-actions button').click()};
}

test('unfinished exam deletion asks for confirmation, cancellation and Escape keep the attempt',async t=>{
  const f=await deletionFixture(t);f.remove();assert.equal(f.document.querySelector('.exam-delete-dialog').open,true);
  assert.equal(f.document.querySelector('.exam-dialog button[type=submit]').disabled,true);assert.equal(f.document.querySelector('.exam-record').disabled,true);
  f.cancel();await f.tick();assert.equal(f.document.querySelector('.exam-delete-dialog').open,false);assert.equal(f.requests.length,1);assert.equal(f.document.querySelector('.exam-record').disabled,false);
  f.remove();const event=new f.document.defaultView.Event('cancel',{cancelable:true});f.document.querySelector('.exam-delete-dialog').dispatchEvent(event);await f.tick();
  assert.equal(event.defaultPrevented,true);assert.equal(f.requests.length,1);assert.equal(f.opened.length,0);assert.equal(f.document.querySelectorAll('.exam-record').length,1);
});

test('confirmed exam deletion uses the existing exam endpoint and locks duplicate operations',async t=>{
  let resolve;const pending=new Promise(yes=>{resolve=yes;});const f=await deletionFixture(t,{remove:()=>pending});
  f.remove();f.accept();await f.tick();assert.equal(f.requests.length,2);assert.equal(f.requests[1].path,'/api/collections/exam/attempt/exam');assert.equal(f.requests[1].options.method,'DELETE');
  f.document.querySelector('.exam-record-delete').click();assert.equal(f.requests.length,2);assert.equal(f.document.querySelector('.exam-dialog-close').disabled,true);
  resolve({deleted:'attempt'});await f.tick();assert.equal(f.document.querySelectorAll('.exam-record').length,0);assert.equal(f.document.querySelector('.exam-resume-section').hidden,true);
  assert.equal(f.document.querySelector('.exam-dialog button[type=submit]').disabled,false);assert.equal(f.document.querySelector('.exam-dialog button[type=submit]'),f.document.activeElement);assert.deepEqual(f.opened,[]);
});

test('failed delete retains the row and shows the failure for retry; a stale missing row is removed',async t=>{
  let fail=true;const f=await deletionFixture(t,{remove:async()=>{throw Object.assign(new Error(fail?'保存失败':'已经删除'),{status:fail?503:404});}});
  f.remove();f.accept();await f.tick();assert.equal(f.document.querySelectorAll('.exam-record').length,1);assert.equal(f.document.querySelector('.exam-error').textContent,'保存失败');assert.equal(f.document.querySelector('.exam-record-delete').disabled,false);
  fail=false;f.remove();f.accept();await f.tick();assert.equal(f.document.querySelectorAll('.exam-record').length,0);assert.equal(f.document.querySelector('.exam-error').hidden,true);
});

test('a completed-while-confirming exam moves out of the dialog with a history explanation',async t=>{
  const row={id:'attempt',status:'in-progress',startedAt:'2026-10-11T02:00:00Z',durationMinutes:null};
  const f=await deletionFixture(t,{rows:[row],remove:async()=>{row.status='completed';throw Object.assign(new Error('考试已完成，请在历史记录中查看或删除。'),{status:409,code:'EXAM_COMPLETED'});}});
  f.remove();f.accept();await f.tick();assert.equal(f.requests.length,3);assert.equal(f.document.querySelectorAll('.exam-record').length,0);assert.match(f.document.querySelector('.exam-error').textContent,/历史记录/);assert.equal(f.opened.length,0);
});

test('duration and unlimited controls keep their values after canceled deletion',async t=>{
  const f=await deletionFixture(t);const unlimited=f.document.querySelector('.exam-unlimited input'),duration=f.document.querySelector('#exam-duration');
  duration.value='90';duration.dispatchEvent(new f.document.defaultView.Event('input'));unlimited.checked=true;unlimited.dispatchEvent(new f.document.defaultView.Event('change'));await f.tick();assert.equal(duration.disabled,true);assert.match(f.document.querySelector('.exam-hint').textContent,/手动交卷/);
  f.remove();f.cancel();await f.tick();assert.equal(unlimited.checked,true);assert.equal(unlimited.disabled,false);assert.equal(duration.disabled,true);assert.equal(duration.value,'90');
  unlimited.checked=false;unlimited.dispatchEvent(new f.document.defaultView.Event('change'));await f.tick();assert.equal(duration.disabled,false);assert.match(f.document.querySelector('.exam-hint').textContent,/自动交卷/);
});
