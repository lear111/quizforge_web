import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {bindAiSettings} from '../web/ai-settings.js';
import {createAiClient} from '../web/ai-client.js';

test('host scopes AI requests and excludes extension-supplied prompt, model and key',async()=>{
  const calls=[],updates=[];
  const client=createAiClient({path:'/api/collections/bank/demo/questions/q1',makeRequestId:()=> 'host-operation-1',settled:async()=>{},request:async(path,options)=>{calls.push({path,body:options&&JSON.parse(options.body)});return path.endsWith('/confirm')?{status:'confirmed',payload:{state:{result:{score:2.5}}}}:{taskId:'task-1',status:'queued'};},onConfirmed:value=>updates.push(value)});
  await client('ai-grade',{model:'spoofed',apiKey:'secret',question:'override'},'content-version');
  assert.deepEqual(calls[0].body,{contentVersion:'content-version',force:false,requestId:'host-operation-1'});
  await client('ai-confirm',{taskId:'task-1',score:2.5,candidateVersion:'candidate-1',feedback:'override'},'content-version');
  assert.deepEqual(calls[1].body,{score:2.5,candidateVersion:'candidate-1',requestId:'host-operation-1'});
  assert.equal(updates[0].state.result.score,2.5);
  await assert.rejects(client('ai-task',{taskId:'../../other'}));
});

test('a lost confirmation response reuses the same operation ID, even after recreating the scoped bridge',async()=>{
  const confirmations=new Map(),ids=[];let sequence=0;
  const options={path:'/api/collections/bank/demo/questions/q1',confirmations,makeRequestId:()=>`host-id-${++sequence}`,settled:async()=>{},onConfirmed:()=>{},request:async(_path,options)=>{ids.push(JSON.parse(options.body).requestId);if(ids.length===1)throw new Error('response lost');return {status:'confirmed',payload:{state:{revision:1}}};}};
  const args={taskId:'task-1',candidateVersion:'version-1',score:3.5};
  await assert.rejects(createAiClient(options)('ai-confirm',args));
  await createAiClient(options)('ai-confirm',args);
  assert.deepEqual(ids,['host-id-1','host-id-1']);assert.equal(confirmations.size,0);
  await createAiClient(options)('ai-confirm',{...args,score:4});assert.equal(ids[2],'host-id-2');
});

test('a confirmed background task refreshes current persisted grading when its reply was lost',async()=>{
  const calls=[],updates=[];
  const client=createAiClient({path:'/question',makeRequestId:()=> 'host-id-1',settled:async()=>{},shouldRefreshTask:()=>true,onConfirmed:value=>updates.push(value),request:async path=>{calls.push(path);return path==='/question'?{state:{revision:5,result:{score:4}}}:{task:{taskId:'task-1',status:'confirmed'}};}});
  await client('ai-task',{});assert.deepEqual(calls,['/question/ai/current','/question']);assert.equal(updates[0].state.result.score,4);
});

for(const method of ['ai-grade','ai-retry'])test(`an immediately confirmed ${method} refreshes the automatically saved score`,async()=>{
  const calls=[],updates=[];
  const client=createAiClient({path:'/question',makeRequestId:()=> 'host-id-1',settled:async()=>{},shouldRefreshTask:()=>true,onConfirmed:value=>updates.push(value),request:async path=>{calls.push(path);return path==='/question'?{state:{revision:3,result:{score:5}}}:{taskId:'task-1',status:'confirmed'};}});
  const reply=await client(method,{taskId:'task-1'},'content-version');
  assert.equal(reply.data.status,'confirmed');assert.equal(calls.at(-1),'/question');assert.equal(updates[0].state.result.score,5);
});

async function fixture(request){
  const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'));
  const document=dom.window.document,dialog=document.getElementById('network-settings-dialog');dialog.open=true;dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new dom.window.Event('close'));};
  const ui=bindAiSettings({request,document});
  return {ui,document,dom,get:id=>document.getElementById(`ai-settings-${id}`)};
}
const profile={canManage:true,enabled:true,baseUrl:'http://localhost:11434/v1',model:'local',apiKeyConfigured:true,vision:false,outputMode:'json',maxOutputTokens:2048,timeoutSeconds:60};
test('AI settings preserve saved key when blank, clear entered secret when closing, and use explicit saved-profile connection test',async()=>{
  const calls=[];
  const f=await fixture(async(path,options)=>{calls.push({path,options});return path.endsWith('/test')?{ok:true}:profile;});
  await f.ui.open();
  assert.equal(f.get('apiKey').value,'');
  const submitted=new Promise(resolve=>{const old= f.get('form').addEventListener('submit',()=>setTimeout(resolve,0),{once:true});});
  f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await submitted;
  const saved=JSON.parse(calls[1].options.body);assert.equal('apiKey' in saved,false);assert.equal(saved.baseUrl,profile.baseUrl);
  f.get('test').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(calls[2].path,'/api/settings/ai/test');assert.equal(calls[2].options.body,'{}');
  f.get('apiKey').value='entered-secret';f.get('close').click();assert.equal(f.get('apiKey').value,'');
  f.ui.destroy();f.dom.window.close();
});
test('remote AI settings are visible but cannot save, test or expose a key field value',async()=>{
  let writes=0;
  const f=await fixture(async(path,options)=>{if(options)writes++;return {...profile,canManage:false};});
  await f.ui.open();assert.equal(f.get('save').disabled,true);assert.equal(f.get('test').disabled,true);assert.equal(f.get('apiKey').disabled,true);assert.equal(f.get('autoGrade').disabled,true);
  f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));assert.equal(writes,0);
  f.ui.destroy();f.dom.window.close();
});

test('automatic AI grading defaults off for legacy status and saves an explicit opt-in without a model request',async()=>{
  const calls=[];
  const f=await fixture(async(path,options)=>{calls.push({path,options});return options?{...profile,autoGrade:JSON.parse(options.body).autoGrade}:profile;});
  await f.ui.open();assert.equal(f.get('autoGrade').checked,false);assert.match(f.get('status').textContent,/题卡点击评分.*自动保存/);
  assert.match(f.get('autoGrade').parentElement.textContent,/提交答案后自动 AI 评分/);
  f.get('autoGrade').checked=true;f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(calls.length,2);assert.equal(calls[1].path,'/api/settings/ai');assert.equal(calls[1].options.method,'PUT');assert.equal(JSON.parse(calls[1].options.body).autoGrade,true);
  assert.equal(f.get('autoGrade').checked,true);assert.equal(calls.some(value=>value.path.endsWith('/test')),false);
  f.ui.destroy();f.dom.window.close();
});

test('saved automatic grading is shown and can be switched off independently of AI enablement',async()=>{
  const calls=[];
  const f=await fixture(async(path,options)=>{calls.push({path,options});return options?{...profile,autoGrade:false}:{...profile,autoGrade:true};});
  await f.ui.open();assert.equal(f.get('autoGrade').checked,true);assert.match(f.get('status').textContent,/提交答案后自动评分.*自动保存/);
  f.get('autoGrade').checked=false;f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await new Promise(resolve=>setTimeout(resolve,0));
  const body=JSON.parse(calls[1].options.body);assert.equal(body.autoGrade,false);assert.equal(body.enabled,true);assert.equal(f.get('autoGrade').checked,false);
  f.ui.destroy();f.dom.window.close();
});
