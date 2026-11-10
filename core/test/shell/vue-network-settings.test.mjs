import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindNetworkSettings} from '../../web/shell/network-settings.js';
const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const state={canManage:true,enabled:true,publicEnabled:true,publicUrl:'',port:8788,passwordConfigured:true,urls:['http://192.0.2.10:8788/'],https:{enabled:true,configured:true,port:8789,urls:['https://192.0.2.10:8789/']}};
function fixture(t,overrides={}){
  const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only'}),document=dom.window.document;loadVueUi(dom);
  const get=id=>document.getElementById(`network-settings-${id}`),dialog=get('dialog');
  dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
  const writes=[],saved=[];const config={document,request:async(path,options)=>{if(options)writes.push({path,...options});return structuredClone(state);},onSaved:async next=>saved.push(next),clipboard:{writeText:async()=>{}},confirm:()=>true,...overrides};
  const view=bindNetworkSettings(config);t.after(()=>{view.destroy();dom.window.close();});
  const submit=async()=>{get('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();};
  const change=(id,value,kind='input')=>{const node=get(id);if(typeof value==='boolean')node.checked=value;else node.value=value;node.dispatchEvent(new dom.window.Event(kind,{bubbles:true}));};
  return {dom,document,get,dialog,config,view,writes,saved,submit,change};
}

test('closing during load immediately allows reopen and old load/finally cannot unlock or replace new state',async t=>{
  const first=deferred(),second=deferred();let calls=0;
  const f=fixture(t,{request:()=>++calls===1?first.promise:second.promise});
  const old=f.view.open();assert.equal(f.get('status').textContent,'正在读取设置…');f.get('close').click();
  assert.equal(f.dialog.open,false);const current=f.view.open();first.resolve({...state,port:9000});await old;
  assert.equal(f.get('form').getAttribute('aria-busy'),'true');assert.equal(f.get('save').disabled,true);
  second.resolve({...state,port:9100});await current;assert.equal(f.get('port').value,'9100');assert.equal(f.get('save').disabled,false);
});

test('save waiting on preparation locks all exits and repeated operations and preserves exact password',async t=>{
  const gate=deferred(),f=fixture(t,{beforeSave:()=>gate.promise});await f.view.open();
  f.get('password').value='  synthetic-password  ';await f.submit();
  assert.equal(f.get('form').getAttribute('aria-busy'),'true');assert.equal(f.get('cancel').disabled,true);assert.equal(f.get('close').disabled,true);
  assert.equal(f.get('save').textContent,'正在保存…');assert.equal(f.writes.length,0);
  const cancel=new f.dom.window.Event('cancel',{cancelable:true});f.dialog.dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);
  await f.submit();await f.view.refresh();assert.equal(f.writes.length,0);gate.resolve();await flush();
  assert.equal(f.writes.length,1);assert.equal(JSON.parse(f.writes[0].body).password,'  synthetic-password  ');
  assert.equal(f.get('password').value,'');assert.equal(f.saved.length,1);assert.equal(f.get('close').disabled,false);
});

test('teardown during preparation prevents a later PUT, clears secret and leaves the replacement mount untouched',async t=>{
  const gate=deferred(),f=fixture(t,{beforeSave:()=>gate.promise});await f.view.open();f.get('password').value='synthetic-key';await f.submit();
  const oldPassword=f.get('password');f.view.destroy();assert.equal(oldPassword.value,'');f.dialog.open=false;
  const next=bindNetworkSettings({...f.config,beforeSave:async()=>{}});t.after(()=>next.destroy());await next.open();
  gate.resolve();await flush();assert.equal(f.writes.length,0);assert.equal(f.get('save').disabled,false);assert.equal(f.get('password').value,'');
});

test('late PUT responses after teardown cannot call onSaved or repopulate a remounted form',async t=>{
  const reply=deferred(),f=fixture(t,{request:async(path,options)=>options?reply.promise:structuredClone(state)});await f.view.open();await f.submit();f.view.destroy();f.dialog.open=false;
  const next=bindNetworkSettings({...f.config,request:async()=>({...state,port:9200})});t.after(()=>next.destroy());await next.open();
  reply.resolve({...state,port:9300});await flush();assert.equal(f.saved.length,0);assert.equal(f.get('port').value,'9200');assert.equal(f.get('save').disabled,false);
});

test('address refresh preserves all unsaved fields including HTTPS and an untouched password',async t=>{
  const f=fixture(t);await f.view.open();
  f.change('port','9000');f.change('public-url','https://edited.example.test/');f.change('https-port','9001');f.change('https-enabled',false,'change');f.get('password').value='synthetic-password';
  await f.view.refresh();assert.equal(f.get('port').value,'9000');assert.equal(f.get('public-url').value,'https://edited.example.test/');
  assert.equal(f.get('https-port').value,'9001');assert.equal(f.get('https-enabled').checked,false);assert.equal(f.get('password').value,'synthetic-password');
});

test('a pending address refresh cannot overwrite a newer save',async t=>{
  const reply=deferred(),f=fixture(t,{request:async(path,options)=>path.includes('?')?reply.promise:options?{...state,port:9000,urls:['http://192.0.2.20:9000/']} :structuredClone(state)});await f.view.open();
  const refresh=f.view.refresh();f.change('port','9000');await f.submit();reply.resolve({...state,urls:['http://192.0.2.30:8788/'],https:{...state.https,urls:['https://192.0.2.30:8789/']}});await refresh;
  assert.equal(f.get('port').value,'9000');assert.ok(!f.get('lan-urls').textContent.includes('192.0.2.30'));assert.equal(f.get('refresh').disabled,false);
});

test('native close clears password; queued close from an old session cannot clear a reopened session',async t=>{
  const f=fixture(t);await f.view.open();f.get('password').value='synthetic-key';f.dialog.open=false;f.dialog.dispatchEvent(new f.dom.window.Event('close'));
  assert.equal(f.get('password').value,'');await f.view.open();f.get('password').value='new-synthetic-key';f.dialog.dispatchEvent(new f.dom.window.Event('close'));assert.equal(f.get('password').value,'new-synthetic-key');
  const cancel=new f.dom.window.Event('cancel',{cancelable:true});f.dialog.dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,false);assert.equal(f.get('password').value,'');
});

test('duplicate binding keeps a single click handler and discards old copy replies',async t=>{
  const copy=deferred();let reads=0;const f=fixture(t,{request:async()=>{reads++;return structuredClone(state);},clipboard:{writeText:()=>copy.promise}});await f.view.open();
  const oldCopy=f.get('lan-urls').querySelector('button');oldCopy.click();
  f.view.destroy();const next=bindNetworkSettings(f.config);t.after(()=>next.destroy());f.dialog.open=false;f.get('open').click();await flush();assert.equal(reads,2);
  copy.resolve();await flush();assert.equal(oldCopy.textContent,'复制');assert.equal(f.get('lan-urls').querySelectorAll('button').length,1);assert.equal(f.get('lan-urls').querySelector('button').textContent,'复制');
});

test('invalid fields send no request and show a focused correction without losing password input',async t=>{
  const f=fixture(t);await f.view.open();f.get('password').value='synthetic-secret';
  f.get('port').value='1023';await f.submit();assert.match(f.get('error').textContent,/1024–65535/);assert.equal(f.writes.length,0);
  f.get('port').value='8788';f.get('public-url').value='https://user:password@example.test/';await f.submit();assert.equal(f.document.activeElement,f.get('public-url'));assert.equal(f.writes.length,0);assert.equal(f.get('password').value,'synthetic-secret');
  f.get('public-url').value='';f.get('https-port').value='8788';await f.submit();assert.equal(f.document.activeElement,f.get('https-port'));assert.equal(f.writes.length,0);
});

test('permission denial blocks even hidden programmatic save and certificate regeneration',async t=>{
  const f=fixture(t,{request:async(path,options)=>{assert.equal(options,undefined);return {...state,canManage:false};},confirm:()=>{throw Error('Must not confirm remotely');}});await f.view.open();
  await f.submit();f.get('https-regenerate').dispatchEvent(new f.dom.window.Event('click',{bubbles:true}));await flush();assert.equal(f.get('fields').hidden,true);assert.equal(f.get('save').disabled,true);
});

test('server errors remain plain text and load failure can be closed and retried',async t=>{
  let attempt=0;const text='<img src=x onerror=alert(1)>';
  const f=fixture(t,{request:async()=>{if(++attempt===1)throw Error(text);return structuredClone(state);}});
  await f.view.open();assert.equal(f.get('error').textContent,text);assert.equal(f.get('error').querySelector('img'),null);assert.equal(f.get('save').disabled,true);
  f.get('cancel').click();await f.view.open();assert.equal(f.get('error').hidden,true);assert.equal(f.get('save').disabled,false);
});

test('invalid QR and non-text certificate metadata are not rendered as remote images or HTML',async t=>{
  const f=fixture(t,{request:async()=>({...state,https:{...state.https,certificateUrls:[5,'<b>address</b>',null],urls:['https://192.0.2.10:8789/'],fingerprint:{text:'invalid'},certificateQr:'https://external.example.test/track.svg',urlQr:'javascript:alert(1)'}})});await f.view.open();
  assert.equal(f.get('https-certificate-qr').getAttribute('src'),null);assert.equal(f.get('https-url-qr').getAttribute('src'),null);
  assert.equal(f.get('https-fingerprint').textContent,'');assert.equal(f.get('https-certificate-urls').textContent,'<b>address</b>');assert.equal(f.get('https-certificate-urls').querySelector('b'),null);
});


test('copy feedback reports failure and its pending reset timer is cleared on teardown',async t=>{
  const f=fixture(t,{clipboard:{writeText:async()=>{throw Error('unavailable');}}});await f.view.open();
  const timers=new Map();let id=0;f.dom.window.setTimeout=callback=>{timers.set(++id,callback);return id;};f.dom.window.clearTimeout=key=>timers.delete(key);
  f.get('lan-urls').querySelector('button').click();await flush();
  assert.equal(f.get('lan-urls').querySelector('button').textContent,'复制失败');assert.equal(timers.size,1);
  f.view.destroy();assert.equal(timers.size,0);
});


test('preparation failure leaves inputs available for retry and never sends a write',async t=>{
  let fail=true;const f=fixture(t,{beforeSave:async()=>{if(fail)throw Error('作答尚未保存');}});await f.view.open();f.get('password').value='synthetic-secret';await f.submit();
  assert.equal(f.writes.length,0);assert.equal(f.get('error').textContent,'作答尚未保存');assert.equal(f.get('password').value,'synthetic-secret');assert.equal(f.get('save').disabled,false);
  fail=false;await f.submit();assert.equal(f.writes.length,1);assert.equal(f.get('password').value,'');
});


test('editing non-secret fields and refreshing addresses never reads the password DOM value',async t=>{
  const f=fixture(t);await f.view.open();const input=f.get('password');
  const descriptor=Object.getOwnPropertyDescriptor(f.dom.window.HTMLInputElement.prototype,'value');let reads=0;
  Object.defineProperty(input,'value',{configurable:true,get(){reads++;return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);}});
  input.value='synthetic-secret';f.change('port','9000');f.change('https-port','9001');await f.view.refresh();assert.equal(reads,0);
  await f.submit();assert.equal(reads,1);assert.equal(f.writes.length,1);assert.equal(JSON.parse(f.writes[0].body).password,'synthetic-secret');
});
