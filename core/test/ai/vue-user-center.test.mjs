import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindUserCenter} from '../../web/ai/user-center.js';
const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const profile={connected:true,user:{name:'演示作者'},device:{name:'演示电脑'},ai:{enabled:true,balance:50000},manageUrl:'https://hub.example.test/devices'};
function fixture(t,overrides={}) {
  const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only'});loadVueUi(dom);const document=dom.window.document,get=id=>document.getElementById(`user-center-${id}`),dialog=document.getElementById('network-settings-dialog');
  dialog.open=true;dialog.close=()=>{dialog.open=false;};const contact=document.getElementById('admin-contact-dialog');contact.showModal=()=>{contact.open=true;};contact.close=()=>{contact.open=false;};
  const calls=[],config={document,login:{login:async()=>null,cancel(){}},request:async(path,options)=>{calls.push({path,...options});return path.endsWith('/admin-contact')?{content:'演示联系方式',revision:1}:path.endsWith('/redeem')?{added:10000,balance:60000}:structuredClone(profile);},...overrides};
  const view=bindUserCenter(config);t.after(()=>{view.destroy();dom.window.close();});
  const redeem=async code=>{get('code').value=code;get('redeem').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();};
  const tab=id=>document.getElementById(`settings-${id}-tab`).click();
  return {dom,document,get,dialog,contact,config,view,calls,redeem,tab};
}

test('switching away during initial load permits reopen and fences the old response and finally',async t=>{
  const first=deferred(),second=deferred();let reads=0;const f=fixture(t,{request:()=>++reads===1?first.promise:second.promise});
  const old=f.view.open();f.tab('network');const current=f.view.open();first.resolve({...profile,user:{name:'obsolete'}});await old;
  assert.equal(f.get('panel').getAttribute('aria-busy'),'true');assert.equal(f.get('contact').hidden,true);second.resolve(profile);await current;assert.equal(f.get('name').textContent,'演示作者');assert.equal(f.get('refresh').disabled,false);
});

test('account and balance states retain existing labels including expired, unavailable and disabled quota',async t=>{
  let value={...profile,unavailable:true};const f=fixture(t,{request:async()=>value});await f.view.open();assert.equal(f.get('points').textContent,'暂时查询不到');assert.match(f.get('status').textContent,/余额可能不是最新/);
  value={...profile,ai:{enabled:false,balance:99}};await f.view.open();assert.equal(f.get('points').textContent,'¥0.00 · 暂不可用');assert.equal(f.get('points').classList.contains('empty'),false);
  value={connected:false,expired:true};await f.view.open();assert.equal(f.get('account').hidden,true);assert.equal(f.get('guest').hidden,false);assert.match(f.get('status').textContent,/登录已失效/);assert.equal(f.get('contact').hidden,false);
});

test('redeem is single-flight, uses trimmed input and never puts the code into props or HTML attributes',async t=>{
  const reply=deferred(),writes=[];const f=fixture(t,{request:async(path,options)=>{if(options){writes.push(JSON.parse(options.body));return reply.promise;}return {...profile,deviceToken:'unexpected-token'};}});await f.view.open();
  await f.redeem(' AI-SYNTHETIC ');await f.redeem('AI-SECOND');f.get('refresh').click();f.get('logout').click();assert.equal(writes.length,1);assert.equal(writes[0].code,'AI-SYNTHETIC');assert.equal(f.get('redeem-submit').textContent,'正在处理…');
  const state=f.get('root')._vnode.component.props.state;assert.equal(JSON.stringify(state).includes('AI-SYNTHETIC'),false);assert.equal(JSON.stringify(state).includes('unexpected-token'),false);assert.equal(f.get('code').getAttribute('value'),null);
  reply.resolve({added:10000,balance:60000});await flush();assert.equal(f.get('code').value,'');assert.equal(f.get('points').textContent,'¥6.00');assert.match(f.get('redeem-result').textContent,/已兑换 ¥1.00/);
});

test('redeem failures retain code, new input clears feedback and expired login reloads current account',async t=>{
  let expired=false;const f=fixture(t,{request:async(path,options)=>{if(options){expired=true;throw Object.assign(Error('请重新登录'),{code:'HUB_LOGIN_REQUIRED'});}return expired?{connected:false,expired:true}:profile;}});await f.view.open();await f.redeem('AI-SYNTHETIC');
  assert.equal(f.get('code').value,'AI-SYNTHETIC');assert.match(f.get('status').textContent,/登录已失效/);assert.equal(f.get('guest').hidden,false);assert.equal(f.get('login').disabled,false);
});

test('leaving during redemption ignores the old result and does not clear a newer draft',async t=>{
  const reply=deferred();const f=fixture(t,{request:async(path,options)=>options?reply.promise:profile});await f.view.open();await f.redeem('AI-FIRST');f.tab('ai');await f.view.open();f.get('code').value='AI-NEW-DRAFT';reply.resolve({added:999,balance:999});await flush();
  assert.equal(f.get('code').value,'AI-NEW-DRAFT');assert.equal(f.get('points').textContent,'¥5.00');assert.equal(f.get('redeem-result').textContent,'');assert.equal(f.get('refresh').disabled,false);
});

test('refresh failure preserves the account and retries without losing an unsubmitted code',async t=>{
  let fail=false;const f=fixture(t,{request:async()=>{if(fail)throw Error('synthetic offline');return profile;}});await f.view.open();f.get('code').value='AI-DRAFT';fail=true;f.get('refresh').click();await flush();assert.match(f.get('error').textContent,/synthetic offline/);assert.equal(f.get('name').textContent,'演示作者');assert.equal(f.get('code').value,'AI-DRAFT');
  fail=false;f.get('refresh').click();await flush();assert.equal(f.get('error').hidden,true);assert.equal(f.get('refresh').disabled,false);
});

test('logout failure preserves account and retry shows the guest state',async t=>{
  let fail=true;const f=fixture(t,{request:async(path,options)=>{if(options){if(fail)throw Error('synthetic logout failure');return {connected:false};}return profile;}});await f.view.open();f.get('logout').click();await flush();assert.match(f.get('error').textContent,/synthetic logout failure/);assert.equal(f.get('account').hidden,false);
  fail=false;f.get('logout').click();await flush();assert.equal(f.get('guest').hidden,false);assert.match(f.get('status').textContent,/已退出登录/);
});

test('cancelled and failed login do not create an account and remain retryable',async t=>{
  let fail=false;const f=fixture(t,{request:async()=>({connected:false}),login:{cancel(){},login:async()=>{if(fail)throw Error('synthetic login failure');return null;}}});await f.view.open();f.get('login').click();await flush();assert.equal(f.get('guest').hidden,false);assert.equal(f.get('login').disabled,false);
  fail=true;f.get('login').click();await flush();assert.match(f.get('error').textContent,/synthetic login failure/);assert.equal(f.get('login').disabled,false);
});

test('late login cannot update a replacement mount and teardown clears code DOM',async t=>{
  const login=deferred();const f=fixture(t,{request:async()=>({connected:false}),login:{login:()=>login.promise,cancel(){}}});await f.view.open();f.get('login').click();await flush();const oldCode=f.get('code');oldCode.value='AI-SYNTHETIC';f.view.destroy();assert.equal(oldCode.value,'');
  const next=bindUserCenter({...f.config,request:async()=>profile});t.after(()=>next.destroy());await next.open();login.resolve({...profile,user:{name:'obsolete'}});await flush();assert.equal(f.get('name').textContent,'演示作者');assert.equal(f.get('refresh').disabled,false);
});

test('remote denial cannot invoke hidden actions or contact even through synthetic events',async t=>{
  let reads=0;const f=fixture(t,{request:async(path,options)=>{reads++;assert.equal(path,'/api/settings/ai/hub');assert.equal(options,undefined);throw Object.assign(Error('local only'),{code:'LOCAL_SETTINGS_ONLY'});},login:{login(){throw Error('forbidden');},cancel(){}}});await f.view.open();
  await f.redeem('AI-SYNTHETIC');for(const id of ['login','logout','refresh','contact'])f.get(id).dispatchEvent(new f.dom.window.Event('click'));await flush();assert.equal(reads,1);assert.equal(f.contact.open,false);assert.match(f.get('status').textContent,/只能在运行 QuizForge/);assert.equal(f.get('error').hidden,true);
});

test('contact is anonymous for local guests and leaving cancels a pending contact read',async t=>{
  const reply=deferred(),options=[];const f=fixture(t,{request:async(path,init)=>{if(path.endsWith('/admin-contact')){options.push(init);return reply.promise;}return {connected:false};}});await f.view.open();f.get('contact').click();assert.equal(f.contact.open,true);assert.equal(options.length,1);assert.equal(options[0].timeoutMs,11000);assert.equal(options[0].body,undefined);
  f.tab('appearance');assert.equal(options[0].signal.aborted,true);assert.equal(f.contact.open,false);reply.resolve({content:'obsolete contact',revision:1});await flush();assert.equal(f.document.getElementById('admin-contact-content').textContent,'');
});

test('queued parent close events cannot hide a reopened account; cancel invalidates a pending refresh',async t=>{
  const reply=deferred();let reads=0;const f=fixture(t,{request:async()=>++reads===2?reply.promise:profile});await f.view.open();f.get('refresh').click();await flush();f.dialog.open=false;f.dialog.dispatchEvent(new f.dom.window.Event('close'));f.dialog.open=true;await f.view.open();f.dialog.dispatchEvent(new f.dom.window.Event('close'));assert.equal(f.get('panel').hidden,false);
  f.dialog.dispatchEvent(new f.dom.window.Event('cancel',{cancelable:true}));reply.resolve({...profile,user:{name:'obsolete'}});await flush();assert.equal(f.get('panel').hidden,true);assert.equal(f.get('name').textContent,'演示作者');
});

test('duplicate binding retains native panel, has one click handler and ignores old contact reads',async t=>{
  const pending=deferred();const f=fixture(t,{request:async path=>path.endsWith('/admin-contact')?pending.promise:profile});await f.view.open();const panel=f.get('panel');f.get('contact').click();let reads=0;
  const next=bindUserCenter({...f.config,request:async path=>{reads++;return path.endsWith('/admin-contact')?{content:'current contact',revision:2}:profile;}});t.after(()=>next.destroy());f.tab('user');await flush();assert.equal(reads,1);assert.equal(f.get('panel'),panel);f.get('contact').click();await flush();pending.resolve({content:'obsolete contact',revision:1});await flush();assert.equal(reads,2);assert.equal(f.document.getElementById('admin-contact-content').textContent,'current contact');
});

test('account names and failures are literal text; initial read failure can be reopened',async t=>{
  const markup='<img src=x onerror=alert(1)>';let fail=true;const f=fixture(t,{request:async()=>{if(fail)throw Error(markup);return {...profile,user:{name:markup}};}});await f.view.open();assert.equal(f.get('error').textContent,markup);assert.equal(f.get('contact').hidden,true);fail=false;await f.view.open();assert.equal(f.get('name').textContent,markup);assert.equal(f.get('name').querySelector('img'),null);assert.equal(f.get('error').hidden,true);
});
