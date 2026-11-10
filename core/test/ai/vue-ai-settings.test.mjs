import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindAiSettings} from '../../web/ai/ai-settings.js';
const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const profile={canManage:true,enabled:true,autoGrade:true,useOfficial:false,useCustom:true,model:'synthetic-model',baseUrl:'https://model.example.test/v1',apiKeyConfigured:true,hub:{connected:false}};
function fixture(t,overrides={}) {
  const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only'});loadVueUi(dom);
  const document=dom.window.document,get=id=>document.getElementById(`ai-settings-${id}`),dialog=document.getElementById('network-settings-dialog');
  dialog.open=true;dialog.close=()=>{dialog.open=false;};let cancels=0;
  const writes=[],config={document,login:{login:async()=>null,cancel(){cancels++;}},request:async(path,options)=>{if(path.endsWith('/credential'))return {apiKey:'synthetic-key'};if(options)writes.push({path,...options});return structuredClone(profile);},...overrides};
  const view=bindAiSettings(config);t.after(()=>{view.destroy();dom.window.close();});
  const change=(id,value,kind='input')=>{const node=get(id);if(typeof value==='boolean')node.checked=value;else node.value=value;node.dispatchEvent(new dom.window.Event(kind,{bubbles:true}));};
  const submit=async()=>{get('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();};
  const tab=id=>document.getElementById(`settings-${id}-tab`).click();
  return {dom,document,get,dialog,config,view,writes,change,submit,tab,get cancels(){return cancels;}};
}

test('switching away during load permits a fresh open and ignores old response and finally',async t=>{
  const old=deferred(),next=deferred();let loads=0;
  const f=fixture(t,{request:path=>path.endsWith('/credential')?{apiKey:'new-key'}:++loads===1?old.promise:next.promise});
  const first=f.view.open();f.tab('network');const current=f.view.open();old.resolve({...profile,model:'obsolete'});await first;
  assert.equal(f.get('save').disabled,true);assert.equal(f.get('form').getAttribute('aria-busy'),'true');
  next.resolve({...profile,model:'current'});await current;assert.equal(f.get('model').value,'current');assert.equal(f.get('apiKey').value,'new-key');
});

test('close during credential load and immediate reopen cannot restore an old key',async t=>{
  const old=deferred();let keys=0;
  const f=fixture(t,{request:async path=>path.endsWith('/credential')?++keys===1?old.promise:{apiKey:'current-key'}:profile});
  const first=f.view.open();await flush();f.get('close').click();f.dialog.open=true;await f.view.open();old.resolve({apiKey:'obsolete-key'});await first;
  assert.equal(f.get('apiKey').value,'current-key');assert.equal(f.get('save').disabled,false);
  f.dialog.dispatchEvent(new f.dom.window.Event('close'));assert.equal(f.get('apiKey').value,'current-key','queued close of old session is ignored');
});

test('a pending save blocks duplicate writes and late completion cannot replace reopened form',async t=>{
  const reply=deferred();let writes=0;
  const f=fixture(t,{request:async(path,options)=>path.endsWith('/credential')?{apiKey:'synthetic-key'}:options?(writes++,reply.promise):profile});await f.view.open();
  await f.submit();await f.submit();f.get('test').click();assert.equal(writes,1);assert.equal(f.get('test').disabled,true);
  f.tab('network');assert.equal(f.get('apiKey').value,'');await f.view.open();reply.resolve({...profile,model:'obsolete'});await flush();
  assert.equal(f.get('model').value,profile.model);assert.equal(f.get('save').disabled,false);
});

test('leaving while model-test preparation is saving prevents the test POST',async t=>{
  const save=deferred(),paths=[];
  const f=fixture(t,{request:async(path,options)=>{paths.push(path);return path.endsWith('/credential')?{apiKey:'synthetic-key'}:options?save.promise:profile;}});await f.view.open();
  f.get('test').click();await flush();assert.equal(f.get('test').textContent,'正在测试…');f.tab('appearance');save.resolve(profile);await flush();
  assert.equal(paths.some(path=>path.endsWith('/test')),false);assert.equal(f.get('apiKey').value,'');
});

test('late model-test result is discarded after destroy and remount',async t=>{
  const result=deferred();
  const f=fixture(t,{request:async path=>path.endsWith('/credential')?{apiKey:'synthetic-key'}:path.endsWith('/test')?result.promise:profile});await f.view.open();f.get('test').click();await flush();
  const oldKey=f.get('apiKey');f.view.destroy();assert.equal(oldKey.value,'');
  const next=bindAiSettings({...f.config,request:async path=>path.endsWith('/credential')?{apiKey:'new-key'}:{...profile,model:'new-model'}});t.after(()=>next.destroy());await next.open();
  result.resolve({summary:'obsolete report',settings:{...profile,model:'obsolete'}});await flush();
  assert.equal(f.get('report').hidden,true);assert.equal(f.get('model').value,'new-model');assert.equal(f.get('apiKey').value,'new-key');
});

test('duplicate binding removes old handlers and retains native form and panel references',async t=>{
  const f=fixture(t),form=f.get('form'),panel=f.get('panel');let loads=0;
  const next=bindAiSettings({...f.config,request:async path=>{loads++;return path.endsWith('/credential')?{apiKey:''}:profile;}});t.after(()=>next.destroy());f.tab('ai');await flush();
  assert.equal(loads,2);assert.equal(f.get('form'),form);assert.equal(f.get('panel'),panel);assert.equal(f.get('root').querySelectorAll('#ai-settings-save').length,1);
});

test('failed toggle restores the confirmed checkbox and keeps the key and edited fields',async t=>{
  const f=fixture(t,{request:async(path,options)=>{if(options)throw Error('synthetic failure');return path.endsWith('/credential')?{apiKey:'synthetic-key'}:profile;}});await f.view.open();
  f.change('model','unsaved-model');f.change('autoGrade',false,'change');await flush();assert.equal(f.get('autoGrade').checked,true);assert.equal(f.get('model').value,'unsaved-model');assert.equal(f.get('apiKey').value,'synthetic-key');assert.match(f.get('error').textContent,/synthetic failure/);
});

test('login is single-flight, cancellation restores checkbox and leaving fences a late success',async t=>{
  const login=deferred();let calls=0;
  const f=fixture(t,{login:{login(){calls++;return login.promise;},cancel(){}}});await f.view.open();f.change('useOfficial',true,'change');f.change('useOfficial',true,'change');await flush();assert.equal(calls,1);assert.equal(f.get('save').disabled,true);
  f.tab('network');login.resolve({connected:true});await flush();assert.equal(f.writes.length,0);assert.equal(f.get('apiKey').value,'');await f.view.open();assert.equal(f.get('useOfficial').checked,false);
});

test('login failure leaves clear feedback and can be retried without a write',async t=>{
  const f=fixture(t,{login:{login:async()=>{throw Error('synthetic login failure');},cancel(){}}});await f.view.open();f.change('useOfficial',true,'change');await flush();
  assert.equal(f.get('useOfficial').checked,false);assert.equal(f.get('save').disabled,false);assert.match(f.get('error').textContent,/synthetic login failure/);assert.equal(f.writes.length,0);
});

test('failed test differentiates saved configuration and preserves key for retry',async t=>{
  const f=fixture(t,{request:async path=>{if(path.endsWith('/test'))throw Error('synthetic timeout');return path.endsWith('/credential')?{apiKey:'synthetic-key'}:profile;}});await f.view.open();f.get('test').click();await flush();
  assert.match(f.get('status').textContent,/配置已保存.*未完成/);assert.equal(f.get('apiKey').value,'synthetic-key');assert.equal(f.get('test').disabled,false);assert.equal(f.get('report').hidden,true);
});

test('remote programmatic change, submit and test cannot read keys, log in or write',async t=>{
  let reads=0;const f=fixture(t,{request:async(path,options)=>{reads++;assert.equal(options,undefined);assert.equal(path,'/api/settings/ai');return {...profile,canManage:false,hub:{connected:true}};},login:{login(){throw Error('forbidden');},cancel(){}}});await f.view.open();
  f.change('useOfficial',true,'change');await f.submit();f.get('test').dispatchEvent(new f.dom.window.Event('click'));await flush();assert.equal(reads,1);assert.equal(f.get('apiKey').value,'');assert.equal(f.get('points').textContent,'已登录');
});

test('non-secret input and automatic checkbox patches never read the password DOM',async t=>{
  const f=fixture(t);await f.view.open();let reads=0;const key=f.get('apiKey'),value=key.value;
  Object.defineProperty(key,'value',{configurable:true,get(){reads++;return value;},set(){}});
  f.change('model','new-model');f.change('autoGrade',false,'change');await flush();assert.equal(reads,0);await f.submit();assert.equal(reads,1);assert.equal(JSON.parse(f.writes.at(-1).body).apiKey,value);
});

test('credentials never enter Vue props and reports render markup as text',async t=>{
  const fake='<img src=x onerror=alert(1)>',f=fixture(t,{request:async path=>path.endsWith('/credential')?{apiKey:'synthetic-key'}:{...profile,apiKey:'unexpected-server-key',testReport:{summary:fake,checks:[{label:fake,status:'passed',message:fake}]}}});await f.view.open();
  const props=f.get('root')._vnode.component.props;assert.equal(JSON.stringify(props.state).includes('synthetic-key'),false);assert.equal(JSON.stringify(props.state).includes('unexpected-server-key'),false);
  assert.ok(f.get('report').textContent.includes(fake));assert.equal(f.get('report').querySelector('img'),null);assert.equal(f.get('apiKey').getAttribute('value'),null);
});

test('late balance refresh after closing cannot pollute reopened account display',async t=>{
  const balance=deferred();let loads=0;
  const f=fixture(t,{request:async path=>path.endsWith('/credential')?{apiKey:''}:path.endsWith('/hub')?balance.promise:{...profile,hub:{connected:++loads===1}}});await f.view.open();f.get('close').click();f.dialog.open=true;await f.view.open();balance.resolve({connected:true,ai:{enabled:true,balance:999999}});await flush();assert.equal(f.get('points').textContent,'未登录');
});
