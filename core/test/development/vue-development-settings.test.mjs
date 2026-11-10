import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindDevelopmentSettings} from '../../web/development/development-settings.js';
const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(t,overrides={}) {
  const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only'});loadVueUi(dom);const document=dom.window.document,get=id=>document.getElementById(`development-settings-${id}`),dialog=document.getElementById('network-settings-dialog');dialog.open=true;dialog.close=()=>{dialog.open=false;};
  const writes=[],updates=[],config={document,request:async(path,options)=>{if(options)writes.push({path,body:JSON.parse(options.body)});return {enabled:options?JSON.parse(options.body).enabled:false,canManage:true};},onSaved:next=>updates.push(next),...overrides};
  const view=bindDevelopmentSettings(config);t.after(()=>{view.destroy();dom.window.close();});
  const change=async checked=>{get('enabled').checked=checked;get('enabled').dispatchEvent(new dom.window.Event('change',{bubbles:true}));await flush();};
  const tab=id=>document.getElementById(`settings-${id}-tab`).click();return {dom,document,get,dialog,config,view,writes,updates,change,tab};
}

test('old initial read and finally cannot replace or unlock a reopened developer form',async t=>{
  const first=deferred(),second=deferred();let reads=0;const f=fixture(t,{request:()=>++reads===1?first.promise:second.promise});const old=f.view.open();await flush();f.tab('network');const current=f.view.open();await flush();first.resolve({enabled:true,canManage:true});await old;
  assert.equal(f.get('form').getAttribute('aria-busy'),'true');assert.equal(f.get('enabled').disabled,true);second.resolve({enabled:false,canManage:true});await current;assert.equal(f.get('enabled').checked,false);assert.equal(f.get('enabled').disabled,false);
});

test('repeated activation while loading does not duplicate the settings read',async t=>{
  const reply=deferred();let reads=0;const f=fixture(t,{request:()=>{reads++;return reply.promise;}});const opening=f.view.open();await flush();f.tab('development');await f.view.open();assert.equal(reads,1);reply.resolve({enabled:false,canManage:true});await opening;
});

test('save preparation captures one intent and suppresses repeated switch and submit actions',async t=>{
  const gate=deferred(),prepared=[];const f=fixture(t,{beforeSave:value=>{prepared.push(value.enabled);return gate.promise;}});await f.view.open();await f.change(true);await f.change(false);f.get('form').dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await flush();
  assert.deepEqual(prepared,[true]);assert.equal(f.writes.length,0);assert.equal(f.get('enabled').checked,true);assert.equal(f.get('enabled').disabled,true);gate.resolve();await flush();assert.deepEqual(f.writes.map(value=>value.body),[{enabled:true}]);assert.equal(f.updates.length,1);assert.equal(f.get('enabled').checked,true);
});

test('destroy during preparation prevents a later PUT or catalog refresh and leaves a new mount usable',async t=>{
  const gate=deferred(),f=fixture(t,{beforeSave:()=>gate.promise});await f.view.open();await f.change(true);f.view.destroy();const next=bindDevelopmentSettings({...f.config,beforeSave:undefined});t.after(()=>next.destroy());await next.open();gate.resolve();await flush();assert.equal(f.writes.length,0);assert.equal(f.updates.length,0);assert.equal(f.get('enabled').checked,false);assert.equal(f.get('enabled').disabled,false);
});

test('destroy after PUT discards old response without calling catalog callbacks in the replacement mount',async t=>{
  const reply=deferred(),f=fixture(t,{request:async(_path,options)=>options?reply.promise:{enabled:false,canManage:true}});await f.view.open();await f.change(true);f.view.destroy();const next=bindDevelopmentSettings({...f.config,request:async()=>({enabled:false,canManage:true})});t.after(()=>next.destroy());await next.open();reply.resolve({enabled:true,canManage:true});await flush();assert.equal(f.updates.length,0);assert.equal(f.get('enabled').checked,false);assert.equal(f.get('enabled').disabled,false);
});

test('a save continues across tab changes and reopening waits for the catalog refresh before GET',async t=>{
  const refresh=deferred();let stored=false,reads=0,callbacks=0;const f=fixture(t,{request:async(_path,options)=>{if(options)stored=JSON.parse(options.body).enabled;else reads++;return {enabled:stored,canManage:true};},onSaved:()=>{callbacks++;return refresh.promise;}});await f.view.open();await f.change(true);assert.equal(callbacks,1);f.tab('network');const opening=f.view.open();await flush();assert.equal(reads,1);assert.equal(f.get('form').getAttribute('aria-busy'),'true');refresh.resolve();await opening;assert.equal(reads,2);assert.equal(f.get('enabled').checked,true);assert.equal(f.get('enabled').disabled,false);assert.equal(callbacks,1);
});

test('leaving again while reopen waits for saving does not issue an obsolete GET',async t=>{
  const gate=deferred();let reads=0;const f=fixture(t,{beforeSave:()=>gate.promise,request:async(_path,options)=>{if(!options)reads++;return {enabled:!!options,canManage:true};}});await f.view.open();await f.change(true);f.tab('network');const reopening=f.view.open();await flush();f.tab('appearance');gate.resolve();await reopening;await flush();assert.equal(reads,1);assert.equal(f.updates.length,1,'accepted setting still refreshes the catalog while mounted');assert.equal(f.get('panel').hidden,true);
});

test('queued close of an old session does not hide reopened settings; native cancel fences old reads',async t=>{
  const reply=deferred();let reads=0;const f=fixture(t,{request:()=>++reads===1?reply.promise:Promise.resolve({enabled:false,canManage:true})});const first=f.view.open();await flush();f.dialog.dispatchEvent(new f.dom.window.Event('cancel',{cancelable:true}));assert.equal(f.get('panel').hidden,true);const next=f.view.open();await next;f.dialog.dispatchEvent(new f.dom.window.Event('close'));assert.equal(f.get('panel').hidden,false);reply.resolve({enabled:true,canManage:true});await first;assert.equal(f.get('enabled').checked,false);
});

test('duplicate binding retains native panel/form and leaves exactly one switch handler',async t=>{
  const f=fixture(t),form=f.get('form'),panel=f.get('panel');await f.view.open();const next=bindDevelopmentSettings(f.config);t.after(()=>next.destroy());f.tab('development');await flush();await f.change(true);assert.equal(f.writes.length,1);assert.equal(f.updates.length,1);assert.equal(f.get('form'),form);assert.equal(f.get('panel'),panel);assert.equal(f.get('root').querySelectorAll('#development-settings-enabled').length,1);
});

test('local-only failure is plain text and programmatic hidden actions cannot save',async t=>{
  let reads=0;const f=fixture(t,{request:async(_path,options)=>{reads++;assert.equal(options,undefined);throw Object.assign(Error('local only'),{code:'LOCAL_SETTINGS_ONLY'});}});await f.view.open();await f.change(true);assert.equal(reads,1);assert.match(f.get('error').textContent,/请在运行 QuizForge/);assert.equal(f.get('enabled').disabled,true);f.tab('network');await f.change(true);assert.equal(reads,1);
});

test('unchanged values do not save and post-save callback failures keep the persisted switch with literal feedback',async t=>{
  const message='<img src=x onerror=alert(1)>',f=fixture(t,{onSaved:async()=>{throw Error(message);}});await f.view.open();await f.change(false);assert.equal(f.writes.length,0);await f.change(true);assert.equal(f.writes.length,1);assert.equal(f.get('enabled').checked,true);assert.equal(f.get('error').textContent,message);assert.equal(f.get('error').querySelector('img'),null);assert.equal(f.get('enabled').disabled,false);
});
