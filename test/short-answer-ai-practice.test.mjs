import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const root=new URL('../',import.meta.url),read=path=>readFileSync(new URL(path,root),'utf8');
const sample=JSON.parse(read('question-banks/short-answer-ai-demo/bank.json')).questions[0],plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve)),deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const candidate=(score=3.5)=>({version:'b'.repeat(64),score,feedback:'依据要点：回答覆盖输入与处理，输出说明不足。'});
const task=(status='queued',extra={})=>({taskId:'task-first',status,...extra});
async function fixture(t,{mode='practice',status='submitted',canAiGrade=true,canReview=true,aiTask=null,handlers={}}={}){
  const dom=new JSDOM(read('extensions/short-answer-1.1.0/practice.html'),{runScripts:'outside-only',url:'http://localhost/'});t.after(()=>dom.window.close());
  const timers=new Map(),aiCalls=[],saved=[],events=[];let nextTimer=0,hooks,editors=0;
  dom.window.setTimeout=(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id;};dom.window.clearTimeout=id=>timers.delete(id);
  const content={isEmpty:doc=>!JSON.stringify(doc).includes('text'),render(host,doc){host.textContent=JSON.stringify(doc);return {ready:Promise.resolve(),destroy(){host.replaceChildren();}};},createEditor(host,{doc}){editors++;return {ready:Promise.resolve(),getDocument:()=>plain(doc),flush:async()=>{},destroy(){editors--;host.replaceChildren();}};}};
  const context={mode,status,question:plain(sample),answer:{formatVersion:1,document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'我的回答'}]}]}},result:status==='submitted'?{gradingStatus:'pending',score:null,maxScore:5,correct:null,feedback:null}:null,aiTask,capabilities:{canSave:status!=='submitted',canSubmit:status!=='submitted',canRetry:mode!=='history',canReview:mode!=='history'&&canReview,canAiGrade:mode!=='history'&&canAiGrade}};
  const ai={};for(const name of ['grade','getTask','retry','confirm'])ai[name]=async args=>{aiCalls.push({method:name,args:plain(args)});return handlers[name]?handlers[name](args,context,hooks):name==='getTask'&&!args.taskId?{ok:true,data:{task:null}}:{ok:true,data:task()};};
  dom.window.QF={content,ai,page:{register:value=>{hooks=value;}},save:async value=>{saved.push(plain(value));return {ok:true};},requestAction:async()=>({ok:true}),ui:{resize(){}}};
  dom.window.eval(read('extensions/short-answer-1.1.0/practice-ai.js'));await hooks.onLoad(context);await tick();
  const byId=id=>dom.window.document.getElementById(id);
  return {dom,hooks,context,timers,aiCalls,saved,byId,editors:()=>editors,async click(id){byId(id).dispatchEvent(new dom.window.Event('click'));await tick();},async poll(){const entry=[...timers.entries()].find(([,value])=>value.delay===1500);assert.ok(entry,'Expected one active poll timer');timers.delete(entry[0]);entry[1].callback();await tick();},async reload(value){await hooks.onLoad(value);await tick();}};
}
test('AI candidate never saves a grade until an explicit human confirmation',async t=>{
  const f=await fixture(t,{handlers:{grade:async()=>({ok:true,data:task('succeeded',{candidate:candidate()})}),confirm:async(args,context,hooks)=>{context.result={gradingStatus:'graded',score:args.score,maxScore:5,correct:false,feedback:'最终得分：3 / 5 分\nAI 原建议：3.5 分\n依据保留'};context.aiTask=task('confirmed');await hooks.onLoad(context);return {ok:true,data:{taskId:'task-first',status:'confirmed',payload:{state:{result:context.result}}}};}}});
  assert.equal(f.aiCalls.length,1);assert.deepEqual(f.aiCalls[0],{method:'getTask',args:{}});await f.click('ai-grade');
  assert.equal(f.byId('ai-candidate').hidden,false);assert.match(f.byId('ai-score').textContent,/3.5/);assert.match(f.byId('result-score').textContent,/待评分/);assert.equal(f.context.result.score,null);assert.equal(f.saved.length,0);assert.equal(f.aiCalls.some(value=>value.method==='confirm'),false);
  f.byId('review-score').value='3';f.byId('review-score').dispatchEvent(new f.dom.window.Event('input'));await f.click('ai-confirm');
  assert.deepEqual(f.aiCalls.at(-1),{method:'confirm',args:{taskId:'task-first',score:3,candidateVersion:'b'.repeat(64)}});assert.match(f.byId('result-feedback').textContent,/AI 原建议：3.5/);assert.match(f.byId('ai-status').textContent,/已确认/);assert.equal(f.saved.length,0);f.hooks.onDispose();
});
test('current-task restore is read-only, polls to completion and stops polling on dispose',async t=>{
  let polls=0;const f=await fixture(t,{handlers:{getTask:async args=>args.taskId?{ok:true,data:++polls===1?task('running'):task('succeeded',{candidate:candidate(4)})}:{ok:true,data:{task:task('queued')}}}});
  assert.equal(f.aiCalls.some(value=>value.method==='grade'),false);assert.equal(f.timers.size,1);await f.poll();assert.match(f.byId('ai-status').textContent,/评分中/);await f.poll();assert.equal(f.byId('review-score').value,'4');assert.equal(f.timers.size,0);assert.equal(f.saved.length,0);
  await f.reload({...f.context,aiTask:task('running')});assert.equal(f.timers.size,1);f.hooks.onDispose();assert.equal(f.timers.size,0);
});
test('failed tasks use retry, regrading uses force and old in-flight poll cannot replace the new candidate',async t=>{
  const old=deferred();let gradeCalls=0;const f=await fixture(t,{handlers:{grade:async args=>{gradeCalls++;return {ok:true,data:args.force?{taskId:'task-second',status:'succeeded',candidate:candidate(5)}:task('queued')};},getTask:async args=>args.taskId?old.promise:{ok:true,data:{task:null}},retry:async()=>({ok:true,data:{taskId:'retry-task',status:'queued'}})}});
  await f.click('ai-grade');const timer=[...f.timers.entries()][0];f.timers.delete(timer[0]);timer[1].callback();await tick();await f.click('ai-regrade');assert.equal(gradeCalls,2);assert.deepEqual(f.aiCalls.find(value=>value.method==='grade'&&value.args.force).args,{force:true});old.resolve({ok:true,data:task('succeeded',{candidate:candidate(1)})});await tick();assert.match(f.byId('ai-score').textContent,/5 \/ 5/);
  await f.reload({...f.context,aiTask:task('failed',{error:{code:'PROVIDER_FAILED',message:'服务暂不可用'}})});assert.match(f.byId('ai-error').textContent,/服务暂不可用/);await f.click('ai-retry');assert.deepEqual(f.aiCalls.at(-1),{method:'retry',args:{taskId:'task-first'}});f.hooks.onDispose();
});
test('network polling failure offers a progress check rather than creating a duplicate task',async t=>{
  let failed=true;const f=await fixture(t,{handlers:{grade:async()=>({ok:true,data:task('queued')}),getTask:async args=>{if(!args.taskId)return {ok:true,data:{task:null}};if(failed){failed=false;return {ok:false,error:{message:'连接超时'}};}return {ok:true,data:task('succeeded',{candidate:candidate()})};}}});
  await f.click('ai-grade');await f.poll();assert.equal(f.byId('ai-retry').textContent,'检查进度');assert.match(f.byId('ai-error').textContent,/连接超时/);await f.click('ai-retry');assert.equal(f.aiCalls.at(-1).method,'getTask');assert.equal(f.aiCalls.filter(value=>value.method==='grade').length,1);assert.equal(f.byId('ai-error').hidden,true);f.hooks.onDispose();
});
test('history and unavailable capability make no AI calls and preserve manual grading',async t=>{
  const history=await fixture(t,{mode:'history',aiTask:task('running')});assert.equal(history.aiCalls.length,0);assert.equal(history.timers.size,0);assert.equal(history.byId('ai-panel').hidden,true);for(const id of ['ai-grade','ai-retry','ai-regrade','ai-confirm'])await history.click(id);assert.equal(history.aiCalls.length,0);history.hooks.onDispose();
  const manual=await fixture(t,{canAiGrade:false});await manual.click('ai-grade');assert.equal(manual.aiCalls.length,0);manual.byId('review-score').value='2.5';await manual.click('review-confirm');assert.deepEqual(manual.saved,[{purpose:'review',data:{review:{score:2.5}}}]);manual.hooks.onDispose();
});
test('dispose cancels timers and ignores a late current-task response without leaking an editor',async t=>{
  const pending=deferred(),f=await fixture(t,{handlers:{getTask:()=>pending.promise}});f.hooks.onDispose();pending.resolve({ok:true,data:{task:task('running')}});await tick();assert.equal(f.timers.size,0);assert.equal(f.byId('ai-status').textContent,'');assert.equal(f.editors(),0);
  const drafting=await fixture(t,{status:'draft'});assert.equal(drafting.editors(),1);drafting.hooks.onDispose();assert.equal(drafting.editors(),0);assert.equal(drafting.aiCalls.length,0);
});

test('manual result update with an explicitly cleared task removes an old succeeded candidate',async t=>{
  let restored=true;const f=await fixture(t,{handlers:{getTask:async()=>({ok:true,data:{task:restored?task('succeeded',{candidate:candidate()}):null}})}});
  assert.equal(f.byId('ai-candidate').hidden,false);restored=false;
  await f.reload({...plain(f.context),aiTask:null,result:{gradingStatus:'graded',score:2.5,maxScore:5,correct:false,feedback:'人工调整后的评分'},capabilities:{...f.context.capabilities,canReview:true,canAiGrade:true}});
  assert.equal(f.byId('ai-candidate').hidden,true);assert.equal(f.byId('ai-confirm').hidden,true);assert.equal(f.byId('ai-grade').hidden,false);assert.match(f.byId('result-feedback').textContent,/人工调整/);assert.equal(f.timers.size,0);f.hooks.onDispose();
});

test('unrelated context update does not discard an AI operation awaiting its response',async t=>{
  const pending=deferred(),f=await fixture(t,{handlers:{grade:()=>pending.promise}});await f.click('ai-grade');
  await f.reload({...plain(f.context),aiTask:null});pending.resolve({ok:true,data:task('succeeded',{candidate:candidate()})});await tick();
  assert.equal(f.byId('ai-candidate').hidden,false);assert.match(f.byId('ai-score').textContent,/3.5/);f.hooks.onDispose();
});

test('manual result update invalidates a grade request that has not returned a task yet',async t=>{
  const pending=deferred(),f=await fixture(t,{handlers:{grade:()=>pending.promise}});await f.click('ai-grade');
  await f.reload({...plain(f.context),aiTask:null,result:{gradingStatus:'graded',score:2,maxScore:5,correct:false,feedback:'手动评分已保存'}});
  pending.resolve({ok:true,data:task('succeeded',{candidate:candidate()})});await tick();
  assert.equal(f.byId('ai-candidate').hidden,true);assert.equal(f.byId('ai-confirm').hidden,true);assert.equal(f.byId('ai-grade').disabled,false);assert.match(f.byId('result-feedback').textContent,/手动评分已保存/);assert.equal(f.timers.size,0);f.hooks.onDispose();
});
