import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {resolveExtensionApi} from '../../web/bridge/api-bridges.js';
import {installFrameCapture} from '../../web/bridge/frame-capture.js';
import {readHostAppearance} from '../../web/shell/appearance.js';

const frameSource=readFileSync(new URL('../../web/bridge/frame.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Mounts a page in a real host DOM so theme, draft and phone changes reach the frame.
function hostFixture(t,{minor=4,phone=false}={}){
  const dom=new JSDOM('<!doctype html><html><body><div class="question-pane"><div id="host"></div></div></body></html>');t.after(()=>dom.window.close());
  const document=dom.window.document,host=document.getElementById('host'),pane=host.parentElement,sent=[],mediaListeners=new Set();
  const media={matches:phone,addEventListener:(name,callback)=>mediaListeners.add(callback),removeEventListener:(name,callback)=>mediaListeners.delete(callback)};
  dom.window.matchMedia=()=>media;
  const frame={style:{},attributes:{},contentWindow:{postMessage:message=>sent.push(structuredClone(message))},setAttribute(name,value){this.attributes[name]=value;},remove(){}};
  let nextId=0;
  const sandbox={Promise,structuredClone,installFrameCapture,resolveExtensionApi,readHostAppearance,makeRequestId:()=>`fixture-${++nextId}`,
    document:{createElement:()=>frame},window:{addEventListener(){},removeEventListener(){}},setTimeout:()=>0,clearTimeout(){}};
  const moduleSource=frameSource.replace(/^import[^\r\n]*\r?\n/gm,'').replace('export function mountExtension','function mountExtension');
  vm.runInNewContext(`${moduleSource}\nglobalThis.mountExtension=mountExtension;`,sandbox);
  const container={ownerDocument:document,closest:selector=>host.closest(selector),append(){}};
  const mount=()=>sandbox.mountExtension(container,{html:'<div></div>',script:'',style:'',apiVersion:{major:1,minor}},{mode:'practice',question:{id:'q1'}},{onRequest:()=>({ok:true}),onError(){}});
  const setPhone=value=>{media.matches=value;for(const callback of mediaListeners)callback();};
  return {document,root:document.documentElement,pane,frame,sent,mount,setPhone,appearanceMessages:()=>sent.filter(value=>value.kind==='appearance').map(value=>value.appearance)};
}

test('the host reads its theme and panel transparency, with none for the default look',()=>{
  const dom=new JSDOM('<!doctype html><html></html>'),root=dom.window.document.documentElement;
  assert.deepEqual(readHostAppearance(root),{theme:'default',transparency:0});
  root.dataset.qfTheme='image';root.style.setProperty('--qf-clear','0.45');
  assert.deepEqual(readHostAppearance(root),{theme:'image',transparency:0.45});
  root.dataset.qfTheme='coast';
  assert.deepEqual(readHostAppearance(root),{theme:'coast',transparency:0.45});
  root.dataset.qfTheme='image';
  root.style.removeProperty('--qf-clear');
  assert.deepEqual(readHostAppearance(root),{theme:'image',transparency:0});
  delete root.dataset.qfTheme;root.style.setProperty('--qf-clear','0.45');
  assert.deepEqual(readHostAppearance(root),{theme:'default',transparency:0});
  dom.window.close();
});

test('API 1.4 pages start with the host appearance and receive changes; draft and phone stay opaque',async t=>{
  const f=hostFixture(t);f.root.dataset.qfTheme='mist';f.root.style.setProperty('--qf-clear','0.4');
  const mounted=f.mount();
  assert.match(f.frame.srcdoc,/<html lang="zh-CN" data-qf-theme="mist" style="--qf-transparency:0.4">/,'CSS sees the appearance before the first paint');
  f.root.style.setProperty('--qf-clear','0.6');await tick();
  f.root.style.setProperty('--unrelated','1');await tick();
  f.pane.classList.add('is-draft');await tick();
  f.pane.classList.remove('is-draft');await tick();
  f.setPhone(true);f.setPhone(false);
  f.root.dataset.qfTheme='image';await tick();
  delete f.root.dataset.qfTheme;await tick();
  assert.deepEqual(f.appearanceMessages(),[
    {theme:'mist',transparency:0.6},{theme:'mist',transparency:0},{theme:'mist',transparency:0.6},
    {theme:'mist',transparency:0},{theme:'mist',transparency:0.6},{theme:'image',transparency:0.6},{theme:'default',transparency:0},
  ],'Only real changes are sent');
  mounted.destroy();f.root.dataset.qfTheme='green';await tick();
  assert.equal(f.appearanceMessages().length,7,'A destroyed page stops listening');
});

test('a page opened in draft mode or on a phone starts opaque',t=>{
  const draft=hostFixture(t);draft.root.dataset.qfTheme='image';draft.root.style.setProperty('--qf-clear','0.3');draft.pane.classList.add('is-draft');draft.mount();
  assert.match(draft.frame.srcdoc,/data-qf-theme="image" style="--qf-transparency:0"/);
  const phone=hostFixture(t,{phone:true});phone.root.dataset.qfTheme='image';phone.root.style.setProperty('--qf-clear','0.3');phone.mount();
  assert.match(phone.frame.srcdoc,/style="--qf-transparency:0"/);
});

test('API 1.3 and older pages and frozen history get no appearance channel',async t=>{
  const f=hostFixture(t,{minor:3});f.root.dataset.qfTheme='mist';f.root.style.setProperty('--qf-clear','0.4');f.mount();
  assert.match(f.frame.srcdoc,/<html lang="zh-CN"><head>/);
  f.root.style.setProperty('--qf-clear','0.6');await tick();
  assert.deepEqual(f.appearanceMessages(),[]);
  assert.equal(resolveExtensionApi({major:1,minor:3}).api.capabilities.includes('appearance'),false);
  assert.deepEqual(resolveExtensionApi({major:1,minor:4}).api.capabilities.slice(-2),['answer-state','appearance']);
});

function pageFixture(t,{minor=4,appearance={theme:'image',transparency:0.3}}={}){
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only'}),window=dom.window,sent=[];t.after(()=>window.close());
  const parent={postMessage:value=>sent.push(structuredClone(value))};
  Object.defineProperty(window,'parent',{value:parent});window.structuredClone=structuredClone;window.ResizeObserver=class{observe(){}disconnect(){}};
  const bridge=resolveExtensionApi({major:1,minor});
  window.eval(`(${bridge.bootstrap.toString()})(${JSON.stringify({session:'look',context:{mode:'practice',question:{id:'q1'}},api:bridge.api,...(minor>=4?{appearance}:{})})});`);
  const deliver=value=>window.dispatchEvent(new window.MessageEvent('message',{source:parent,data:{channel:'quizforge-host',session:'look',kind:'appearance',appearance:value}}));
  return {window,QF:window.QF,root:window.document.documentElement,sent,deliver};
}

test('pages read QF.ui.appearance and subscribe to changes, mirrored on <html>',t=>{
  const f=pageFixture(t);
  assert.deepEqual({...f.QF.ui.appearance},{theme:'image',transparency:0.3});assert.equal(Object.isFrozen(f.QF.ui.appearance),true);
  const seen=[],stop=f.QF.ui.onAppearanceChange(value=>seen.push({...value}));
  assert.throws(()=>f.QF.ui.onAppearanceChange('nope'),{name:'TypeError'});
  f.deliver({theme:'mist',transparency:0.55});
  assert.deepEqual(seen,[{theme:'mist',transparency:0.55}]);assert.deepEqual({...f.QF.ui.appearance},{theme:'mist',transparency:0.55});
  assert.equal(f.root.dataset.qfTheme,'mist');assert.equal(f.root.style.getPropertyValue('--qf-transparency'),'0.55');
  for(const bad of [null,{theme:'Mist',transparency:0.2},{theme:'mist',transparency:1.5},{theme:'mist',transparency:'0.2'},{theme:'x'.repeat(40),transparency:0}])f.deliver(bad);
  assert.equal(seen.length,1,'Malformed updates are ignored');
  stop();f.deliver({theme:'green',transparency:0});
  assert.equal(seen.length,1,'Unsubscribed callbacks are not called');assert.equal(f.root.dataset.qfTheme,'green');
});

test('a throwing appearance callback is reported without stopping other callbacks',t=>{
  const f=pageFixture(t),seen=[];
  f.QF.ui.onAppearanceChange(()=>{throw new Error('broken');});f.QF.ui.onAppearanceChange(value=>seen.push(value.theme));
  f.deliver({theme:'paper',transparency:0});
  assert.deepEqual(seen,['paper']);assert.equal(f.sent.find(value=>value.kind==='error')?.message,'broken');
});

test('API 1.3 pages keep the old QF.ui surface',t=>{
  const f=pageFixture(t,{minor:3});
  assert.deepEqual(Object.keys(f.QF.ui),['resize']);
  f.deliver({theme:'mist',transparency:0.4});
  assert.equal(f.root.hasAttribute('data-qf-theme'),false);
});
