import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindAppearanceSettings} from '../../web/shell/appearance.js';
const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(t,{saved={},images=null,prepare=async()=>new Blob(['new'],{type:'image/jpeg'})}={}){
  const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only'});loadVueUi(dom);
  const document=dom.window.document,values=new Map([['quizforge-appearance',JSON.stringify(saved)]]),writes=[];
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>{writes.push(value);values.set(key,value);}};
  const urls=new Set(),revoked=[];let id=0;
  const URL={createObjectURL:()=>{const url=`blob:test/${++id}`;urls.add(url);return url;},revokeObjectURL:url=>{revoked.push(url);urls.delete(url);}};
  const config={document,storage,images,URL,prepare};const view=bindAppearanceSettings(config);
  const get=id=>document.getElementById(`appearance-${id}`),root=document.documentElement;
  const pick=()=>{const input=get('image-file');Object.defineProperty(input,'files',{configurable:true,value:[new dom.window.File(['x'],'test.png',{type:'image/png'})]});input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
  t.after(()=>{view.destroy();dom.window.close();});
  return {dom,document,config,view,get,root,pick,urls,revoked,writes,saved:()=>JSON.parse(values.get('quizforge-appearance'))};
}

test('actual Vue form retains theme radio focus and updates percentage labels synchronously',t=>{
  const f=fixture(t);f.view.open();
  const list=f.get('themes');list.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
  assert.equal(f.root.dataset.qfTheme,'coast');assert.equal(f.document.activeElement.dataset.theme,'coast');
  assert.equal(f.get('image-actions').hidden,true);
  f.get('dim').value='70';f.get('dim').dispatchEvent(new f.dom.window.Event('input'));
  assert.equal(f.get('dim-value').textContent,'70%');assert.equal(f.saved().dim,70);
  assert.equal(f.get('themes').querySelectorAll('[tabindex="0"]').length,1);
});

test('image preparation locks duplicate upload/reset and permits switching tabs without losing the pending result',async t=>{
  const gate=deferred(),puts=[],removes=[];
  const f=fixture(t,{images:{get:async()=>undefined,put:async blob=>puts.push(blob),remove:async()=>removes.push(true)},prepare:()=>gate.promise});
  f.view.open();f.pick();assert.equal(f.get('image-choose').disabled,true);assert.equal(f.get('image-reset').disabled,true);
  assert.equal(f.get('image-choose').textContent,'正在处理图片…');f.pick();
  f.document.getElementById('settings-ai-tab').click();assert.equal(f.document.getElementById('appearance-settings-panel').hidden,true);
  f.get('image-reset').click();gate.resolve(new Blob(['picture']));await flush();
  assert.equal(puts.length,1);assert.equal(removes.length,0);assert.equal(f.saved().custom,true);assert.equal(f.urls.size,1);
  f.view.open();assert.equal(f.get('image-choose').disabled,false);assert.equal(f.get('image-reset').hidden,false);
});

test('image errors are plain text, preserve the previous picture and can be retried',async t=>{
  let attempt=0;const puts=[];
  const f=fixture(t,{saved:{custom:true},images:{get:async()=>new Blob(['old']),put:async blob=>puts.push(blob),remove:async()=>{}},prepare:async()=>{if(++attempt===1)throw Error('<img src=x onerror=alert(1)>');return new Blob(['new']);}});
  await f.view.ready;const old=f.root.style.getPropertyValue('--qf-image');f.pick();await flush();
  assert.equal(f.get('error').textContent,'<img src=x onerror=alert(1)>');assert.equal(f.get('error').querySelector('img'),null);
  assert.equal(f.root.style.getPropertyValue('--qf-image'),old);assert.equal(f.get('image-choose').disabled,false);assert.equal(puts.length,0);
  f.pick();await flush();assert.equal(puts.length,1);assert.equal(f.get('error').hidden,true);assert.notEqual(f.root.style.getPropertyValue('--qf-image'),old);assert.equal(f.urls.size,1);assert.equal(f.revoked.length,1);
});

test('failed image store write/reset preserves preferences and releases the busy state for retry',async t=>{
  let fail=true;const f=fixture(t,{saved:{custom:true},images:{get:async()=>new Blob(['old']),put:async()=>{throw Error('本地空间不足');},remove:async()=>{if(fail)throw Error('恢复失败');}}});
  await f.view.ready;const old=f.root.style.getPropertyValue('--qf-image');f.pick();await flush();
  assert.equal(f.get('error').textContent,'本地空间不足');assert.equal(f.root.style.getPropertyValue('--qf-image'),old);
  f.get('image-reset').click();await flush();assert.equal(f.saved().custom,true);assert.equal(f.get('error').textContent,'恢复失败');
  fail=false;f.get('image-reset').click();await flush();assert.equal(f.saved().custom,false);assert.equal(f.get('image-reset').hidden,true);assert.equal(f.urls.size,0);assert.equal(f.get('error').hidden,true);
});

test('initial image read cannot overwrite a newer reset or newly uploaded picture',async t=>{
  const old=deferred(),f=fixture(t,{saved:{custom:true},images:{get:()=>old.promise,put:async()=>{},remove:async()=>{}}});
  f.get('image-reset').click();await flush();old.resolve(new Blob(['old']));await f.view.ready;
  assert.equal(f.saved().custom,false);assert.equal(f.urls.size,0);assert.equal(f.root.style.getPropertyValue('--qf-image'),'');
  const old2=deferred(),g=fixture(t,{saved:{custom:true},images:{get:()=>old2.promise,put:async()=>{},remove:async()=>{}}});
  g.pick();await flush();const url=g.root.style.getPropertyValue('--qf-image');old2.resolve(new Blob(['old']));await g.view.ready;
  assert.equal(g.root.style.getPropertyValue('--qf-image'),url);assert.equal(g.urls.size,1);assert.equal(g.revoked.length,0);
});

test('destroy during decoding prevents persistence and a replacement mount receives no old callbacks',async t=>{
  const gate=deferred(),puts=[],f=fixture(t,{images:{get:async()=>undefined,put:async blob=>puts.push(blob),remove:async()=>{}},prepare:()=>gate.promise});
  f.pick();f.view.destroy();const next=bindAppearanceSettings(f.config);t.after(()=>next.destroy());
  f.document.querySelector('[data-theme="green"]').click();const writes=f.writes.length;
  gate.resolve(new Blob(['late']));await flush();assert.equal(puts.length,0);assert.equal(f.writes.length,writes);
  assert.equal(f.root.dataset.qfTheme,'green');assert.equal(f.get('image-choose').disabled,false);assert.equal(f.get('themes').children.length,7);
  f.view.open();assert.equal(f.document.getElementById('appearance-settings-panel').hidden,true,'Old open handler is inert');
  next.open();assert.equal(f.document.getElementById('appearance-settings-panel').hidden,false);
});

test('destroy during an already-sent local write or read prevents late rendering and object URL leaks',async t=>{
  const put=deferred(),f=fixture(t,{images:{get:async()=>undefined,put:()=>put.promise,remove:async()=>{}}});
  f.pick();await flush();f.view.destroy();const writes=f.writes.length;put.resolve();await flush();
  assert.equal(f.get('themes'),null);assert.equal(f.writes.length,writes);assert.equal(f.urls.size,0);
  const read=deferred(),g=fixture(t,{saved:{custom:true},images:{get:()=>read.promise,put:async()=>{},remove:async()=>{}}});
  g.view.destroy();read.resolve(new Blob(['late']));await g.view.ready;assert.equal(g.urls.size,0);assert.equal(g.get('themes'),null);
});

test('duplicate binding removes prior listeners; queued native close cannot hide a newly opened panel',async t=>{
  const f=fixture(t,{saved:{custom:true},images:{get:async()=>new Blob(['old']),put:async()=>{},remove:async()=>{}}});await f.view.ready;
  const next=bindAppearanceSettings(f.config);t.after(()=>next.destroy());await next.ready;
  assert.equal(f.urls.size,1);assert.equal(f.revoked.length,1);
  f.document.getElementById('settings-appearance-tab').click();
  const dialog=f.document.getElementById('network-settings-dialog');dialog.open=true;dialog.dispatchEvent(new f.dom.window.Event('close'));
  assert.equal(f.document.getElementById('appearance-settings-panel').hidden,false);
  dialog.open=false;dialog.dispatchEvent(new f.dom.window.Event('close'));assert.equal(f.document.getElementById('appearance-settings-panel').hidden,true);
  next.destroy();next.destroy();assert.equal(f.urls.size,0);assert.equal(f.root.style.getPropertyValue('--qf-image'),'');
});
