import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {bindAiSettings} from '../../web/ai/ai-settings.js';
import {bindUserCenter} from '../../web/ai/user-center.js';
import {createHubLogin} from '../../web/ai/hub-login.js';
import {createAiClient} from '../../web/ai/ai-client.js';

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

test('targeted grading and lookup keep stable child IDs while excluding model inputs',async()=>{
  const calls=[];
  const client=createAiClient({path:'/question',makeRequestId:()=> 'host-child-request',settled:async()=>{},onConfirmed:()=>{},request:async(path,options)=>{calls.push({path,body:options&&JSON.parse(options.body)});return {taskId:'task-child',targetId:'小题二',status:'queued'};}});
  await client('ai-grade',{targetId:'小题二',force:true,answer:'override'},'version');
  assert.deepEqual(calls[0],{path:'/question/ai/grade',body:{contentVersion:'version',force:true,targetId:'小题二',requestId:'host-child-request'}});
  await client('ai-task',{targetId:'小题二'});
  assert.equal(calls[1].path,`/question/ai/current?targetId=${encodeURIComponent('小题二')}`);
  await client('ai-task',{taskId:'task-child'});assert.equal(calls[2].path,'/question/ai/tasks/task-child');
  await client('ai-retry',{taskId:'task-child'});assert.deepEqual(calls[3].body,{requestId:'host-child-request'});
  for(const targetId of ['',null,' leading','<b>','x'.repeat(129)])await assert.rejects(client('ai-grade',{targetId}));
  assert.equal(calls.length,4);
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
  const dom=new JSDOM(await readFile(new URL('../../web/index.html',import.meta.url),'utf8'));
  const document=dom.window.document,dialog=document.getElementById('network-settings-dialog');dialog.open=true;dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new dom.window.Event('close'));};
  const ui=bindAiSettings({request,document});
  return {ui,document,dom,get:id=>document.getElementById(`ai-settings-${id}`)};
}
const profile={canManage:true,enabled:true,useOfficial:false,useCustom:true,baseUrl:'http://localhost:11434/v1',model:'local',apiKeyConfigured:true,vision:false,outputMode:'json',maxOutputTokens:8192,timeoutSeconds:90};
const credential='synthetic-saved-key';
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
const passedReport={ok:true,status:'passed',summary:'文字评分与基础图片识别均通过。',model:'local',testedAt:'2026-10-10T01:00:00Z',calls:2,elapsedMs:450,checks:[{id:'connection',label:'文字连接',status:'passed',message:'模型已响应。'},{id:'gradingFormat',label:'评分输出',status:'passed',message:'评分格式正常。'},{id:'vision',label:'图片识别',status:'passed',message:'已识别随机图片。'}],note:'复杂图片仍需验证。'};

test('simple AI settings restore a masked editable key and retain it after saving',async()=>{
  const calls=[];
  const f=await fixture(async(path,options)=>{calls.push({path,options});return path.endsWith('/credential')?{apiKey:credential}:profile;});
  await f.ui.open();assert.equal(f.get('apiKey').value,credential);assert.equal(f.get('apiKey').type,'password');
  for(const field of ['vision','outputMode','maxOutputTokens','timeoutSeconds','clearApiKey'])assert.equal(f.get(field),null);
  f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await settle();
  const saved=JSON.parse(calls[2].options.body);assert.equal(saved.apiKey,credential);assert.equal(saved.baseUrl,profile.baseUrl);assert.equal(f.get('apiKey').value,credential);
  assert.equal('vision' in saved,false);assert.equal('outputMode' in saved,false);
  f.get('close').click();assert.equal(f.get('apiKey').value,'');
  f.ui.destroy();f.dom.window.close();
});

test('deleting or replacing the password field updates the stored key without a separate checkbox',async()=>{
  const bodies=[];
  const f=await fixture(async(path,options)=>{if(path.endsWith('/credential'))return {apiKey:credential};if(options){const body=JSON.parse(options.body);bodies.push(body);return {...profile,apiKeyConfigured:!body.clearApiKey};}return profile;});
  await f.ui.open();f.get('apiKey').value='';f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await settle();
  assert.equal(bodies[0].clearApiKey,true);assert.equal('apiKey' in bodies[0],false);assert.equal(f.get('apiKey').value,'');
  f.get('apiKey').value='synthetic-replacement-key';f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await settle();
  assert.equal(bodies[1].apiKey,'synthetic-replacement-key');assert.equal('clearApiKey' in bodies[1],false);assert.equal(f.get('apiKey').value,'synthetic-replacement-key');
  f.ui.destroy();f.dom.window.close();
});

test('AI disabled setting survives a successful save and reopening the real settings form',async()=>{
  let stored={...profile,autoGrade:true};
  const f=await fixture(async(path,options)=>{if(path.endsWith('/credential'))return {apiKey:credential};if(options)stored={...stored,...JSON.parse(options.body)};return stored;});
  await f.ui.open();f.get('enabled').checked=false;f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await settle();
  assert.equal(stored.enabled,false);assert.equal(f.get('enabled').checked,false);assert.match(f.get('status').textContent,/已保存/);
  f.get('close').click();f.document.getElementById('network-settings-dialog').open=true;await f.ui.open();
  assert.equal(f.get('enabled').checked,false);assert.equal(f.get('autoGrade').checked,true);
  f.ui.destroy();f.dom.window.close();
});

test('failed AI persistence replaces stale success text and never starts model diagnostics',async()=>{
  const calls=[],f=await fixture(async(path,options)=>{calls.push(path);if(path.endsWith('/credential'))return {apiKey:credential};if(options)throw Object.assign(new Error('Request could not be completed'),{code:'INTERNAL_ERROR',status:500});return profile;});
  await f.ui.open();f.get('status').textContent='AI 设置已保存。';f.get('enabled').checked=false;
  f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await settle();
  assert.match(f.get('status').textContent,/未保存/);assert.match(f.get('error').textContent,/重启/);assert.equal(f.get('enabled').checked,false);
  f.get('test').click();await settle();assert.match(f.get('status').textContent,/未保存.*未执行/);assert.equal(calls.some(path=>path.endsWith('/test')),false);
  f.ui.destroy();f.dom.window.close();
});

test('one test button saves current input and renders all diagnostics even with AI grading disabled',async()=>{
  const calls=[];
  const f=await fixture(async(path,options)=>{
    calls.push({path,options});if(path.endsWith('/credential'))return {apiKey:credential};
    if(path.endsWith('/test'))return {...passedReport,settings:{...profile,enabled:false,vision:true,testReport:passedReport}};
    return {...profile,enabled:false};
  });
  await f.ui.open();assert.equal(f.get('test').disabled,false);
  f.get('model').value='changed-model';f.get('apiKey').value='changed-synthetic-key';f.get('test').click();await settle();await settle();
  assert.deepEqual(calls.slice(2).map(call=>[call.path,call.options.method]),[['/api/settings/ai','PUT'],['/api/settings/ai/test','POST']]);
  assert.equal(JSON.parse(calls[2].options.body).model,'changed-model');assert.equal(JSON.parse(calls[2].options.body).apiKey,'changed-synthetic-key');
  assert.equal(f.get('apiKey').value,'changed-synthetic-key');assert.equal(f.get('report').hidden,false);assert.equal(f.get('report').querySelectorAll('li').length,3);
  assert.match(f.get('report').textContent,/文字连接.*通过.*评分输出.*通过.*图片识别.*通过/s);
  assert.equal(f.get('test').disabled,false);assert.match(f.get('status').textContent,/测试已完成/);
  f.ui.destroy();f.dom.window.close();
});

test('failed vision report remains visible and edited configuration clears stale diagnostics',async()=>{
  const partial={...passedReport,status:'partial',summary:'文字评分可用，图片识别尚未通过。',checks:passedReport.checks.map(check=>check.id==='vision'?{...check,status:'unknown',message:'模型调用等待超时。'}:check)};
  const f=await fixture(async path=>path.endsWith('/credential')?{apiKey:credential}:{...profile,testReport:partial});
  await f.ui.open();assert.match(f.get('report').textContent,/无法判断/);assert.match(f.get('report').textContent,/超时/);
  f.get('model').value='new-model';f.get('model').dispatchEvent(new f.dom.window.Event('input'));assert.equal(f.get('report').hidden,true);assert.match(f.get('status').textContent,/配置有修改/);
  f.ui.destroy();f.dom.window.close();
});

test('remote settings never request credentials and cannot save or test',async()=>{
  const calls=[];
  const f=await fixture(async(path,options)=>{calls.push({path,options});return {...profile,canManage:false};});
  await f.ui.open();assert.equal(calls.length,1);assert.equal(f.get('apiKey').value,'');
  for(const name of ['save','test','apiKey','autoGrade'])assert.equal(f.get(name).disabled,true);
  f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));assert.equal(calls.length,1);
  f.ui.destroy();f.dom.window.close();
});

test('automatic grading is independently editable and ordinary save never invokes model tests',async()=>{
  const calls=[];
  const f=await fixture(async(path,options)=>{calls.push({path,options});if(path.endsWith('/credential'))return {apiKey:credential};return options?{...profile,autoGrade:JSON.parse(options.body).autoGrade}:profile;});
  await f.ui.open();assert.equal(f.get('autoGrade').checked,false);assert.match(f.get('status').textContent,/题卡点击评分.*自动保存/);
  f.get('autoGrade').checked=true;f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await settle();
  assert.equal(calls.length,3);assert.equal(JSON.parse(calls[2].options.body).autoGrade,true);assert.equal(f.get('autoGrade').checked,true);
  assert.equal(calls.some(call=>call.path.endsWith('/test')),false);
  f.get('autoGrade').checked=false;f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await settle();assert.equal(f.get('autoGrade').checked,false);
  f.ui.destroy();f.dom.window.close();
});

test('closing settings before a credential response arrives does not restore the secret',async()=>{
  let resolve;
  const f=await fixture(async path=>path.endsWith('/credential')?await new Promise(done=>{resolve=done;}):profile);
  const opening=f.ui.open();await settle();f.get('close').click();resolve({apiKey:credential});await opening;
  assert.equal(f.get('apiKey').value,'');assert.equal(f.document.getElementById('network-settings-dialog').open,false);
  f.ui.destroy();f.dom.window.close();
});

test('an old backend missing the credential endpoint explains restart and cannot clear the existing key',async()=>{
  const calls=[];
  const f=await fixture(async(path,options)=>{calls.push({path,options});if(path.endsWith('/credential'))throw Object.assign(new Error('Endpoint not found'),{status:404,code:'NOT_FOUND'});return profile;});
  await f.ui.open();assert.match(f.get('error').textContent,/关闭原启动窗口.*重新启动/);assert.equal(f.get('save').disabled,true);assert.equal(f.get('apiKey').value,'');
  f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));assert.equal(calls.length,2);
  f.ui.destroy();f.dom.window.close();
});

test('the switch reveals the options and every switch or checkbox saves at once',async()=>{
  const bodies=[];let stored={...profile,enabled:false};
  const f=await fixture(async(path,options)=>{if(path.endsWith('/credential'))return {apiKey:credential};if(path.endsWith('/hub'))return {connected:false};if(options){const body=JSON.parse(options.body);bodies.push(body);stored={...stored,...body};}return stored;});
  await f.ui.open();
  assert.equal(f.get('options').hidden,true,'only the switch shows while AI grading is off');assert.match(f.get('status').textContent,/未开启/);
  const change=name=>{f.get(name).checked=!f.get(name).checked;f.get(name).dispatchEvent(new f.dom.window.Event('change'));return settle();};
  await change('enabled');
  assert.deepEqual(bodies.at(-1),{enabled:true});assert.equal(f.get('options').hidden,false);assert.equal(f.get('custom').hidden,false);
  await change('autoGrade');assert.deepEqual(bodies.at(-1),{autoGrade:true});assert.match(f.get('status').textContent,/提交答案后自动评分/);
  await change('useCustom');assert.deepEqual(bodies.at(-1),{useCustom:false});assert.equal(f.get('custom').hidden,true,'the model fields hide with the checkbox');
  assert.match(f.get('status').textContent,/至少一个评分来源/);
  f.ui.destroy();f.dom.window.close();
});

test('checking the custom model without a saved address shows the fields and waits for 保存',async()=>{
  const bodies=[];
  const f=await fixture(async(path,options)=>{if(path.endsWith('/credential'))return {apiKey:''};if(path.endsWith('/hub'))return {connected:false};if(options){const body=JSON.parse(options.body);bodies.push(body);return {...profile,...body,useOfficial:false};}return {...profile,baseUrl:'',model:'',useCustom:false};});
  await f.ui.open();assert.equal(f.get('custom').hidden,true);
  f.get('useCustom').checked=true;f.get('useCustom').dispatchEvent(new f.dom.window.Event('change'));await settle();
  assert.equal(bodies.length,0,'nothing is saved before the address is filled in');assert.equal(f.get('custom').hidden,false);assert.match(f.get('status').textContent,/填写服务地址和模型名称/);
  assert.equal(f.get('test').disabled,true);
  f.get('baseUrl').value='http://localhost:11434/v1';f.get('model').value='local';f.get('model').dispatchEvent(new f.dom.window.Event('input'));
  f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await settle();
  assert.equal(bodies[0].useCustom,true);assert.equal(bodies[0].baseUrl,'http://localhost:11434/v1');assert.equal(bodies[0].clearApiKey,true);
  f.ui.destroy();f.dom.window.close();
});

test('choosing the free quota while logged out opens the login dialog; cancelling unchecks it, logging in saves it and shows the points',async()=>{
  const dom=new JSDOM(await readFile(new URL('../../web/index.html',import.meta.url),'utf8'));
  const document=dom.window.document,dialog=document.getElementById('network-settings-dialog');dialog.open=true;dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new dom.window.Event('close'));};
  let connected=false,timers=[];const opened=[],bodies=[];
  const request=async(path,options)=>{
    if(path.endsWith('/credential'))return {apiKey:credential};
    if(path.endsWith('/hub/login'))return {authorizeUrl:'https://quizforge.treenewbee.cloud/connect/authorize?v=1'};
    if(path.endsWith('/hub'))return connected?{connected:true,user:{name:'alice'},device:{name:'书房电脑',client:'web'},ai:{enabled:true,model:'通义千问 qwen-vl-plus',points:42}}:{connected:false};
    if(options){const body=JSON.parse(options.body);bodies.push(body);return {...profile,...body,hub:{connected}};}
    return {...profile,hub:{connected:false}};};
  const ui=bindAiSettings({request,document,openWindow:url=>opened.push(url),setTimer:fn=>{timers.push(fn);return timers.length;},clearTimer:()=>{}});
  const get=id=>document.getElementById(`ai-settings-${id}`),login=document.getElementById('hub-login-dialog');
  await ui.open();assert.equal(get('points').textContent,'未登录');
  const choose=()=>{get('useOfficial').checked=true;get('useOfficial').dispatchEvent(new dom.window.Event('change'));return settle();};
  await choose();
  assert.equal(login.open,true,'a login dialog opens instead of an inline hint');assert.deepEqual(opened,['https://quizforge.treenewbee.cloud/connect/authorize?v=1']);
  assert.equal(document.getElementById('hub-login-link').href,opened[0],'a manual link backs up a blocked pop-up');
  document.getElementById('hub-login-cancel').click();await settle();
  assert.equal(login.open,false);assert.equal(get('useOfficial').checked,false,'cancelling unchecks the free quota');assert.equal(bodies.length,0);assert.match(get('status').textContent,/没有登录/);
  await choose();await timers.shift()();assert.equal(timers.length,1,'still waiting while not connected');
  connected=true;await timers.shift()();await settle();
  assert.equal(login.open,false,'the dialog closes by itself after the login');assert.deepEqual(bodies,[{useOfficial:true}]);
  assert.equal(get('useOfficial').checked,true);assert.equal(get('points').textContent,'剩余 42 点');assert.match(get('status').textContent,/免费 AI 额度已开启/);
  ui.destroy();dom.window.close();
});

test('remote devices see the sources but cannot change them or log in',async()=>{
  const f=await fixture(async path=>{assert.equal(path.endsWith('/hub'),false,'remote settings never query the Hub account');return {...profile,useOfficial:true,canManage:false,hub:{connected:true,user:{name:'alice'},device:{name:'pc'}}};});
  await f.ui.open();
  assert.equal(f.get('useOfficial').checked,true);for(const name of ['enabled','useOfficial','useCustom'])assert.equal(f.get(name).disabled,true,name);
  assert.equal(f.document.getElementById('hub-login-dialog').open,false);
  f.ui.destroy();f.dom.window.close();
});

async function userCenter(request){
  const dom=new JSDOM(await readFile(new URL('../../web/index.html',import.meta.url),'utf8'));
  const document=dom.window.document,dialog=document.getElementById('network-settings-dialog');dialog.open=true;dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new dom.window.Event('close'));};
  const timers=[],login=createHubLogin({request,document,openWindow:()=>{},setTimer:fn=>{timers.push(fn);return timers.length;},clearTimer:()=>{}});
  const ui=bindUserCenter({request,login,document});
  return {ui,dom,document,timers,get:id=>document.getElementById(`user-center-${id}`)};
}

test('the user center shows the account and points, redeems codes and logs out',async()=>{
  const calls=[];let connected=true,points=5;
  const f=await userCenter(async(path,options)=>{calls.push({path,body:options?.body&&JSON.parse(options.body)});
    if(path.endsWith('/hub/redeem')){const {code}=JSON.parse(options.body);if(code!=='AI-GOOD')throw Object.assign(new Error('兑换码无效、已使用或已过期。'),{code:'REDEEM_CODE_INVALID',status:400});points+=100;return {added:100,points};}
    if(path.endsWith('/hub/logout')){connected=false;return {connected:false};}
    return connected?{connected:true,user:{name:'alice'},device:{name:'书房电脑'},ai:{enabled:true,points},manageUrl:'https://quizforge.treenewbee.cloud/manage/'}:{connected:false};});
  f.document.getElementById('settings-user-tab').click();await settle();
  assert.equal(f.get('panel').hidden,false);assert.equal(f.document.getElementById('ai-settings-panel').hidden,true);assert.equal(f.document.getElementById('network-settings-form').hidden,true);
  assert.equal(f.get('name').textContent,'alice');assert.equal(f.get('avatar').textContent,'a');assert.match(f.get('device').textContent,/书房电脑/);assert.equal(f.get('points').textContent,'5 点');
  assert.equal(f.get('manage').href,'https://quizforge.treenewbee.cloud/manage/');assert.equal(f.get('guest').hidden,true);
  const redeem=code=>{f.get('code').value=code;f.get('redeem').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));return settle().then(settle);};
  await redeem('');assert.match(f.get('redeem-result').textContent,/请输入兑换码/);assert.equal(calls.some(call=>call.path.endsWith('/redeem')),false);
  await redeem('AI-BAD');assert.match(f.get('redeem-result').textContent,/无效/);assert.ok(f.get('redeem-result').classList.contains('error'));assert.equal(f.get('code').value,'AI-BAD','a wrong code stays for correction');
  await redeem(' AI-GOOD ');assert.equal(calls.at(-1).body.code,'AI-GOOD');assert.match(f.get('redeem-result').textContent,/已兑换 100 点，当前剩余 105 点/);assert.equal(f.get('points').textContent,'105 点');assert.equal(f.get('code').value,'');
  f.get('logout').click();await settle();await settle();
  assert.equal(f.get('account').hidden,true);assert.equal(f.get('guest').hidden,false);assert.match(f.get('status').textContent,/已退出登录/);
  f.document.getElementById('settings-network-tab').click();assert.equal(f.get('panel').hidden,true);
  f.ui.destroy();f.dom.window.close();
});

test('a logged-out user center logs in through the dialog, and remote devices only see an explanation',async()=>{
  let connected=false;
  const f=await userCenter(async path=>{if(path.endsWith('/hub/login'))return {authorizeUrl:'https://quizforge.treenewbee.cloud/connect/authorize?v=1'};return connected?{connected:true,user:{name:'bob'},device:{name:'pc'},ai:{enabled:true,points:0}}:{connected:false};});
  await f.ui.open();assert.equal(f.get('guest').hidden,false);assert.equal(f.get('account').hidden,true);
  f.get('login').click();await settle();assert.equal(f.document.getElementById('hub-login-dialog').open,true);
  connected=true;await f.timers.shift()();await settle();
  assert.equal(f.document.getElementById('hub-login-dialog').open,false);assert.equal(f.get('name').textContent,'bob');assert.equal(f.get('points').textContent,'0 点');assert.ok(f.get('points').classList.contains('empty'));
  f.ui.destroy();f.dom.window.close();
  const remote=await userCenter(async()=>{throw Object.assign(new Error('Open settings on the host computer'),{code:'LOCAL_SETTINGS_ONLY',status:403});});
  await remote.ui.open();assert.match(remote.get('status').textContent,/只能在运行 QuizForge 的电脑上/);assert.equal(remote.get('guest').hidden,true);assert.equal(remote.get('account').hidden,true);assert.equal(remote.get('error').hidden,true);
  remote.ui.destroy();remote.dom.window.close();
});
