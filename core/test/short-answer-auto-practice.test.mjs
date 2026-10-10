import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

const root=new URL('../../',import.meta.url),read=path=>readFileSync(new URL(path,root),'utf8'),plain=value=>JSON.parse(JSON.stringify(value));
const packagePath='extensions/基础题型/short-answer-1.3.0/',previousPath='core/test/fixtures/legacy-extensions/short-answer-1.2.2/';
const sample=JSON.parse(read(packagePath+'examples.json')).questions[0];
const doc=text=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const candidate=score=>({version:'b'.repeat(64),score,feedback:`最终得分：${score} / 5 分\n回答覆盖主要要点。`});
const task=(status,extra={})=>({taskId:'auto-task',status,...extra});

async function fixture(t,{mode='practice',status='submitted',canAiGrade=true,canReview=true,aiTask=null,handlers={}}={}){
  const dom=new JSDOM(read(packagePath+'practice.html'),{runScripts:'outside-only',url:'http://localhost/'});t.after(()=>dom.window.close());
  const timers=new Map(),saved=[],aiCalls=[],actions=[];let timerId=0,hooks,editors=0;
  dom.window.setTimeout=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;};dom.window.clearTimeout=id=>timers.delete(id);
  const context={mode,status,question:plain(sample),answer:{formatVersion:1,document:doc('我的回答')},result:status==='submitted'?{gradingStatus:'graded',score:0,maxScore:sample.data.maxScore,correct:false,feedback:null}:null,aiTask,capabilities:{canSave:status!=='submitted',canSubmit:status!=='submitted',canRetry:mode!=='history',canReview:mode!=='history'&&canReview,canAiGrade:mode!=='history'&&canAiGrade}};
  const content={isEmpty:value=>!JSON.stringify(value).includes('text'),render(host,value){host.textContent=JSON.stringify(value);return {ready:Promise.resolve(),destroy(){host.replaceChildren();}};},createEditor(host,{doc:initial,onChange}){editors++;let value=plain(initial);return {ready:Promise.resolve(),getDocument:()=>plain(value),flush:async()=>{},change(next){value=plain(next);onChange(next);},destroy(){editors--;host.replaceChildren();}};}};
  async function applySaved(value){
    if(value.purpose==='review')context.result={gradingStatus:'graded',score:value.data.review.score,maxScore:sample.data.maxScore,correct:value.data.review.score===sample.data.maxScore,feedback:null};
    else if(value.purpose==='submit'){context.status='submitted';context.answer=plain(value.data.answer);context.result={gradingStatus:'graded',score:0,maxScore:sample.data.maxScore,correct:false,feedback:null};context.capabilities={...context.capabilities,canSave:false,canSubmit:false,canReview:true};}
    await hooks.onLoad(plain(context));return {ok:true};
  }
  const ai={};for(const method of ['grade','getTask','retry','confirm'])ai[method]=async args=>{aiCalls.push({method,args:plain(args)});return handlers[method]?handlers[method](args,context,hooks):{ok:true,data:{task:null}};};
  dom.window.QF={content,ai,page:{register:value=>{hooks=value;}},save:async value=>{saved.push(plain(value));return handlers.save?handlers.save(value,context,hooks,applySaved):applySaved(value);},requestAction:async value=>{actions.push(value);return {ok:true};},ui:{resize(){}}};
  dom.window.eval(read(packagePath+'practice-ai.js'));await hooks.onLoad(plain(context));await tick();
  t.after(()=>hooks.onDispose());const byId=id=>dom.window.document.getElementById(id);
  return {dom,hooks,context,timers,saved,aiCalls,actions,byId,editors:()=>editors,
    async input(score){byId('review-score').value=String(score);byId('review-score').dispatchEvent(new dom.window.Event('input'));await tick();},
    async click(id){byId(id).dispatchEvent(new dom.window.Event('click'));await tick();},
    async timer(delay){const entry=[...timers.entries()].find(([,value])=>value.delay===delay);assert.ok(entry,`Expected a ${delay} ms timer`);timers.delete(entry[0]);entry[1].callback();await tick();},
    async reload(next=plain(context)){await hooks.onLoad(next);await tick();}
  };
}

test('new package uses API 1.2 and richtext capabilities while editor, schemas and assets retain their bytes',()=>{
  const manifest=JSON.parse(read(packagePath+'manifest.json'));assert.equal(manifest.version,'1.3.0');assert.equal(manifest.requiresApi.minMinor,2);assert.equal(manifest.requiresRichText.documentProfile,'advanced-v1');assert.equal(manifest.dependencies,undefined);
  const examples=JSON.parse(read(packagePath+'examples.json'));assert.equal(examples.extension.version,'1.3.0');assert.deepEqual(examples.questions,JSON.parse(read(previousPath+'examples.json')).questions);
  for(const file of ['editor.js','editor.css','editor.html','editor.json','question.schema.json','answer.schema.json','practice.css','src/ai-document.js'])assert.equal(read(packagePath+file),read(previousPath+file),file);
  for(const asset of readdirSync(new URL(packagePath+'assets/',root)))assert.deepEqual(readFileSync(new URL(packagePath+'assets/'+asset,root)),readFileSync(new URL(previousPath+'assets/'+asset,root)));
  const extension=fileURLToPath(new URL(packagePath,root));
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('core/server/rules-runner.cjs',root))],{input:JSON.stringify({apiVersion:{major:1,minor:2},apiCapabilities:manifest.requiresApi.capabilities,rules:extension+'rules.js',questionSchema:extension+'question.schema.json',answerSchema:extension+'answer.schema.json',op:'submit',data:sample.data,answer:{formatVersion:1,document:doc('完整回答')}}),encoding:'utf8',timeout:5000,maxBuffer:3*1024*1024});
  assert.equal(result.status,0,result.stderr);const reply=JSON.parse(result.stdout);assert.equal(reply.ok,true,JSON.stringify(reply.error));assert.equal(reply.data.result.score,0);assert.equal(reply.data.result.gradingStatus,'graded');assert.equal(reply.data.result.maxScore,sample.data.maxScore);
  const script=read(packagePath+'practice-ai.js'),html=read(packagePath+'practice.html');assert.doesNotMatch(script,/QF\.ai\.confirm|review-confirm|ai-confirm/);assert.doesNotMatch(html,/review-confirm|ai-confirm|确认.*评分/);
});

test('slider debounces rapid adjustments and automatically saves the last half-point score',async t=>{
  const f=await fixture(t);assert.equal(f.byId('review-score').step,'0.5');assert.equal(f.saved.length,0);assert.equal(f.aiCalls.some(row=>row.method==='grade'),false);
  await f.input(1);await f.input(2.5);await f.input(4);assert.equal(f.saved.length,0);assert.equal([...f.timers.values()].filter(value=>value.delay===180).length,1);
  await f.timer(180);await f.hooks.onFlush();assert.deepEqual(f.saved,[{purpose:'review',data:{review:{score:4}}}]);assert.equal(f.byId('review-score').value,'4');assert.match(f.byId('result-score').textContent,/4 \/ 5/);assert.match(f.byId('save-notice').textContent,/自动保存/);
});

test('in-flight save serializes a newer slider value and flush waits for its final save',async t=>{
  const first=deferred(),last=deferred();let saves=0,active=0,maximum=0;
  const f=await fixture(t,{handlers:{save:async(value,_context,_hooks,apply)=>{saves++;active++;maximum=Math.max(maximum,active);await(saves===1?first.promise:last.promise);const reply=await apply(value);active--;return reply;}}});
  await f.input(2);await f.timer(180);assert.equal(f.saved.length,1);assert.equal(f.byId('review-score').disabled,false,'Dragging stays available while saving');
  await f.input(4.5);await f.reload();assert.equal(f.byId('review-score').value,'4.5','Host onLoad cannot overwrite the unsaved selection');
  let flushed=false;const flushing=f.hooks.onFlush().then(()=>{flushed=true;});await tick();assert.equal(flushed,false);
  first.resolve();await tick();assert.equal(f.saved.length,2);assert.equal(f.byId('review-score').value,'4.5');assert.equal(flushed,false);assert.equal(maximum,1);
  last.resolve();await flushing;await tick();assert.deepEqual(f.saved.map(row=>row.data.review.score),[2,4.5]);assert.equal(f.byId('review-score').value,'4.5');assert.equal(flushed,true);assert.equal(f.context.result.score,4.5);
});

test('failed saves preserve local score and block flush until retry succeeds',async t=>{
  let failed=true;const f=await fixture(t,{handlers:{save:async(value,_context,_hooks,apply)=>failed?{ok:false,error:{message:'磁盘写入失败'}}:apply(value)}});
  await f.input(2.5);await f.timer(180);assert.equal(f.byId('review-retry').hidden,false);assert.equal(f.byId('review-score').value,'2.5');assert.match(f.byId('save-notice').textContent,/当前分数仍保留/);
  await f.reload();assert.equal(f.byId('review-score').value,'2.5');await assert.rejects(f.hooks.onFlush(),/磁盘写入失败/);assert.equal(f.actions.length,0);
  failed=false;await f.click('review-retry');await f.hooks.onFlush();assert.equal(f.context.result.score,2.5);assert.equal(f.byId('review-retry').hidden,true);assert.equal(f.byId('review-score').value,'2.5');assert.deepEqual(f.saved.map(row=>row.data.review.score),[2.5,2.5,2.5]);
});

test('submit writes the initial zero through grade without a second review or frontend model call',async t=>{
  const f=await fixture(t,{status:'draft'});await f.click('submit-button');await f.hooks.onFlush();assert.deepEqual(f.saved.map(row=>row.purpose),['submit']);assert.equal(f.context.result.score,0);assert.equal(f.byId('review-score').value,'0');assert.equal(f.aiCalls.some(row=>row.method==='grade'||row.method==='confirm'),false);assert.equal(f.editors(),0);
});

test('task restoration is read-only, polls through succeeded, and confirmed host result updates score and feedback',async t=>{
  let polls=0;const f=await fixture(t,{handlers:{getTask:async(args,context,hooks)=>{if(!args.taskId)return {ok:true,data:{task:task('queued')}};polls++;if(polls===1)return {ok:true,data:task('succeeded',{candidate:candidate(4)})};context.result={gradingStatus:'graded',score:4,maxScore:5,correct:false,feedback:candidate(4).feedback};context.aiTask=task('confirmed',{candidate:candidate(4)});await hooks.onLoad(plain(context));return {ok:true,data:plain(context.aiTask)};}}});
  await f.timer(1500);assert.equal(f.byId('review-score').value,'0','A transient candidate does not become an unsaved manual edit');assert.equal([...f.timers.values()].some(value=>value.delay===1500),true);
  await f.timer(1500);assert.equal(f.byId('review-score').value,'4');assert.match(f.byId('result-feedback').textContent,/最终得分：4/);assert.match(f.byId('ai-status').textContent,/已保存/);assert.equal(f.timers.size,0);assert.equal(f.saved.length,0);assert.equal(f.aiCalls.some(row=>row.method==='confirm'||row.method==='grade'),false);
});

test('manual AI button and retry remain available without confirmation calls',async t=>{
  const f=await fixture(t,{handlers:{grade:async()=>({ok:true,data:task('failed',{error:{message:'服务暂不可用'}})}),retry:async()=>({ok:true,data:task('queued')})}});
  await f.click('ai-grade');assert.match(f.byId('ai-error').textContent,/服务暂不可用/);await f.click('ai-retry');assert.deepEqual(f.aiCalls.at(-1),{method:'retry',args:{taskId:'auto-task'}});assert.equal(f.aiCalls.some(row=>row.method==='confirm'),false);assert.equal(f.saved.length,0);
});

test('manual save wins over a late AI task and pending slider edits survive host score updates',async t=>{
  const late=deferred(),f=await fixture(t,{handlers:{grade:()=>late.promise}});await f.click('ai-grade');await f.input(3);
  await f.reload({...plain(f.context),aiTask:null,result:{gradingStatus:'graded',score:4,maxScore:5,correct:false,feedback:'AI 分值'}});assert.equal(f.byId('review-score').value,'3');
  await f.timer(180);late.resolve({ok:true,data:task('succeeded',{candidate:candidate(1)})});await tick();assert.equal(f.byId('review-score').value,'3');assert.equal(f.byId('ai-candidate').hidden,true);assert.equal(f.timers.size,0);
});

test('history, finished rounds and disposal cannot save manual scores or start model calls',async t=>{
  for(const options of [{mode:'history'},{canReview:false}]){
    const f=await fixture(t,options);await f.input(3);await f.click('review-retry');await f.hooks.onFlush();assert.equal(f.saved.length,0);assert.equal(f.byId('review-panel').hidden,true);assert.equal(f.aiCalls.some(row=>row.method==='grade'||row.method==='confirm'),false);
  }
  const f=await fixture(t);await f.input(2);assert.equal(f.timers.size,1);f.hooks.onDispose();assert.equal(f.timers.size,0);assert.equal(f.saved.length,0);assert.equal(f.editors(),0);
});
