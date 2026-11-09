import {loadVueUi} from '../fixtures/vue-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {renderLibraryView} from '../../web/library/library-view.js';

const module = await import('../../web/library/library-index-client.js').catch(()=>({}));
const pending={banks:[{id:'bank',title:'Bank',kind:'bank',questionCount:2,validationStatus:'pending'}],extensions:[],developmentEnabled:false};
function fixture() {
  assert.equal(typeof module.createLibraryIndexClient,'function');
  let visible=true;const timers=new Map(),calls=[],values=[],errors=[];let id=0;
  const client=module.createLibraryIndexClient({request:async(path)=>{calls.push(path);return structuredClone(values.shift()||pending);},onIndex:value=>valuesSeen.push(value),onError:error=>errors.push(error),isVisible:()=>visible,setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:id=>timers.delete(id)});
  const valuesSeen=[];
  return {client,timers,calls,values,valuesSeen,errors,hide(){visible=false;client.visibilityChanged();},show(){visible=true;client.visibilityChanged();},async tick(){const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();}};
}
test('unopened entries are delivered immediately without scheduling validation polling',async()=>{
  const f=fixture();await f.client.refresh();assert.equal(f.valuesSeen.length,1);assert.deepEqual(f.calls,['/api/library/index']);assert.equal(f.timers.size,0);
  f.values.push({...pending,banks:[{...pending.banks[0],validationStatus:'checking'}]});await f.client.refresh();assert.equal(f.valuesSeen.length,2);assert.equal(f.timers.size,0);
});
test('visibility changes do not scan unopened entries and stop fences further refreshes',async()=>{
  const f=fixture();await f.client.refresh();f.hide();f.show();assert.equal(f.timers.size,0);assert.equal(f.calls.length,1);
  f.client.stop();f.show();await f.client.refresh();assert.equal(f.calls.length,1);
});
test('a manual refresh supersedes old requests without delivering stale data',async()=>{
  assert.equal(typeof module.createLibraryIndexClient,'function');const resolves=[],seen=[];
  const client=module.createLibraryIndexClient({request:()=>new Promise(resolve=>resolves.push(resolve)),onIndex:value=>seen.push(value),isVisible:()=>false});
  const old=client.refresh(),current=client.refresh();resolves[1]({...pending,indexRevision:'new'});await current;resolves[0]({...pending,indexRevision:'old'});assert.equal(await old,undefined);assert.deepEqual(seen.map(row=>row.indexRevision),['new']);client.stop();
});
test('auth failure stops polling and an explicit retry succeeds',async()=>{
  assert.equal(typeof module.createLibraryIndexClient,'function');let rejected=true;const errors=[],seen=[],timers=[];
  const client=module.createLibraryIndexClient({request:async()=>{if(rejected)throw Object.assign(new Error('login'),{status:401});return pending;},onIndex:value=>seen.push(value),onError:error=>errors.push(error),setTimer:fn=>{timers.push(fn);return 1;},clearTimer:()=>{}});
  await assert.rejects(client.refresh(),{status:401});assert.equal(timers.length,0);rejected=false;await client.refresh();assert.equal(seen.length,1);client.stop();
});
test('pending and checking rows stay clickable; error rows report their error',t=>{
  const dom=new JSDOM(readFileSync(new URL('../../web/index.html',import.meta.url),'utf8'),{runScripts:'outside-only'});loadVueUi(dom);t.after(()=>dom.window.close());const opened=[],notices=[];
  const catalog={...pending,banks:[pending.banks[0],{...pending.banks[0],id:'checking',validationStatus:'checking'},{...pending.banks[0],id:'bad',validationStatus:'error',error:'Invalid rule'}],canManage:false};
  renderLibraryView({document:dom.window.document,catalog,listMode:'bank',activeKey:null,collapsedGroups:new Set(),onNotice:value=>notices.push(value),onOpen:(kind,id)=>opened.push(id)});
  assert.doesNotMatch(dom.window.document.querySelector('[data-item-id="bank"]').textContent,/待校验/);assert.doesNotMatch(dom.window.document.querySelector('[data-item-id="checking"]').textContent,/校验中/);
  for(const id of ['bank','checking','bad'])dom.window.document.querySelector(`[data-item-id="${id}"]`).click();assert.deepEqual(opened,['bank','checking']);assert.deepEqual(notices,['Invalid rule']);
});
