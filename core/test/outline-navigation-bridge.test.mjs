import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {bootstrapV1} from '../web/api-v1.js';
import {resolveExtensionApi} from '../web/api-bridges.js';
import {validateContentApi} from '../web/page-assets.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const frameSource=readFileSync(new URL('../web/frame.js',import.meta.url),'utf8').replace(/^import[^\r\n]*\r?\n/gm,'').replace('export function mountExtension','function mountExtension');

function childFixture(mode='practice',minor=1){
  const listeners=new Map(),sent=[],timers=new Map();let timerId=0;
  const parent={postMessage:message=>sent.push(structuredClone(message))},context={mode,question:{id:'parent-question'},capabilities:{canSave:mode==='practice',canEdit:mode==='edit'}};
  const boot={session:'outline-child',context,api:resolveExtensionApi({major:1,minor}).api};
  const sandbox={parent,Promise,structuredClone,document:{body:{scrollHeight:100},documentElement:{}},ResizeObserver:class{observe(){}disconnect(){}},setTimeout(callback){const id=++timerId;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),addEventListener:(name,callback)=>listeners.set(name,callback)};
  vm.runInNewContext(`(${bootstrapV1.toString()})(${JSON.stringify(boot)});`,sandbox);
  const receive=(value,{source=parent,session=boot.session}={})=>listeners.get('message')({source,data:{...value,channel:'quizforge-host',session}});
  return {QF:sandbox.QF,sent,timers,receive,context};
}

function hostFixture(minor=1){
  const listeners=new Map(),sent=[],timers=new Map();let id=0,timerId=0;
  const frame={style:{},contentWindow:{postMessage:value=>sent.push(structuredClone(value))},setAttribute(){},remove(){this.removed=true;}};
  const sandbox={Promise,resolveExtensionApi,validateContentApi,makeRequestId:()=>`outline-host-${++id}`,document:{createElement:()=>frame},window:{addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name)},setTimeout(callback){const key=++timerId;timers.set(key,callback);return key;},clearTimeout:key=>timers.delete(key)};
  vm.runInNewContext(`${frameSource}\nglobalThis.mount=mountExtension;`,sandbox);
  const mounted=sandbox.mount({append(){}},{html:'',script:'',style:'',apiVersion:{major:1,minor}},{mode:'history',question:{id:'parent-question'},capabilities:{canSave:false}},{onRequest(){throw new Error('Navigation must not use save requests.');},onError(){}});
  mounted.ready.catch(()=>{});
  const receive=(value,{source=frame.contentWindow,session='outline-host-1'}={})=>listeners.get('message')?.({source,data:{...value,channel:'quizforge-extension',session}});
  return {mounted,frame,sent,timers,receive};
}

test('API 1.1 adds outline navigation while missing and explicit 1.0 keep their frozen contract',()=>{
  const old=resolveExtensionApi(),explicitOld=resolveExtensionApi({major:1,minor:0}),next=resolveExtensionApi({major:1,minor:1});
  assert.equal(old,explicitOld);assert.equal(old.api.minor,0);assert.equal(old.api.capabilities.includes('outline-items'),false);
  assert.equal(next.api.minor,1);assert.deepEqual([...next.api.capabilities],[...old.api.capabilities,'outline-items']);assert.equal(next.bootstrap,old.bootstrap);assert.equal(Object.isFrozen(next.api.capabilities),true);
  assert.throws(()=>resolveExtensionApi({major:1,minor:2}),error=>error.code==='UNSUPPORTED_API_VERSION');
});

test('practice, editor and readonly history hooks locate children without reloading parent context',async()=>{
  for(const mode of ['practice','edit','history']){
    const f=childFixture(mode),selected=[];let loaded=0;
    const hooks={onLoad(){loaded++;},getDocument:()=>({title:'unchanged'}),onOutlineNavigate:itemId=>selected.push(itemId)};
    await (mode==='edit'?f.QF.editor:f.QF.page).register(hooks);f.sent.length=0;
    f.receive({kind:'outline-navigate',id:'focus-child',itemId:'小题 2'});await tick();
    assert.deepEqual(selected,['小题 2']);assert.equal(loaded,1);assert.equal(f.sent.some(value=>value.kind==='request'),false);
    const reply=f.sent.find(value=>value.kind==='outline-navigated');assert.equal(reply.ok,true);assert.equal(reply.id,'focus-child');assert.equal(reply.session,'outline-child');
    assert.equal(f.context.capabilities.canSave,mode==='practice');f.receive({kind:'dispose'});
  }
});

test('outline callbacks acknowledge after completion and execute in request order',async()=>{
  const f=childFixture(),first=deferred(),second=deferred(),calls=[];
  await f.QF.page.register({onLoad(){},onOutlineNavigate(itemId){calls.push(itemId);return itemId==='a'?first.promise:second.promise;}});f.sent.length=0;
  f.receive({kind:'outline-navigate',id:'first',itemId:'a'});f.receive({kind:'outline-navigate',id:'second',itemId:'b'});await tick();
  assert.deepEqual(calls,['a']);assert.equal(f.sent.some(value=>value.kind==='outline-navigated'),false);
  first.resolve();await tick();assert.deepEqual(calls,['a','b']);assert.deepEqual(f.sent.filter(value=>value.kind==='outline-navigated').map(value=>value.id),['first']);
  second.reject(Object.assign(new Error('子题已不存在'),{code:'OUTLINE_ITEM_NOT_FOUND'}));await tick();
  const failure=f.sent.find(value=>value.id==='second');assert.equal(failure.ok,false);assert.equal(failure.error.code,'OUTLINE_ITEM_NOT_FOUND');assert.equal(failure.error.message,'子题已不存在');f.receive({kind:'dispose'});
});

test('invalid hooks and child identifiers fail clearly while scoped spoofed messages are ignored',async()=>{
  const f=childFixture(),calls=[];
  await assert.rejects(f.QF.page.register({onLoad(){},onOutlineNavigate:'selector'}),/onOutlineNavigate/);
  await f.QF.page.register({onLoad(){},onOutlineNavigate:itemId=>calls.push(itemId)});f.sent.length=0;
  for(const scope of [{source:{}},{session:'other-frame'}])f.receive({kind:'outline-navigate',id:'forged',itemId:'child'},scope);
  for(const itemId of ['',null,'x'.repeat(129),' leading','trailing ','<node>','a\n','a\u0085b'])f.receive({kind:'outline-navigate',id:'invalid',itemId});await tick();
  assert.deepEqual(calls,[]);assert.equal(f.sent.some(value=>value.id==='forged'),false);assert.equal(f.sent.filter(value=>value.kind==='outline-navigated').every(value=>value.error.code==='INVALID_OUTLINE_ITEM'),true);f.receive({kind:'dispose'});
  const missing=childFixture();await missing.QF.page.register({onLoad(){}});missing.receive({kind:'outline-navigate',id:'unsupported',itemId:'child'});assert.equal(missing.sent.at(-1).error.code,'OUTLINE_UNAVAILABLE');missing.receive({kind:'dispose'});
  const removed=childFixture('edit');await removed.QF.editor.register({onLoad(){},getDocument(){return {};},onOutlineNavigate:()=>false});removed.receive({kind:'outline-navigate',id:'removed',itemId:'child'});await tick();assert.equal(removed.sent.at(-1).error.code,'OUTLINE_ITEM_NOT_FOUND');removed.receive({kind:'dispose'});
  const old=childFixture('history',0);await old.QF.page.register({onLoad(){},onOutlineNavigate(){throw new Error('A frozen API 1.0 page must not receive the new hook.');}});old.receive({kind:'outline-navigate',id:'old',itemId:'child'});assert.equal(old.sent.at(-1).error.code,'OUTLINE_UNAVAILABLE');old.receive({kind:'dispose'});
});

test('child disposal cancels queued callbacks and suppresses late acknowledgement',async()=>{
  const f=childFixture(),waiting=deferred(),calls=[];
  await f.QF.page.register({onLoad(){},onOutlineNavigate:itemId=>{calls.push(itemId);return waiting.promise;}});f.sent.length=0;
  f.receive({kind:'outline-navigate',id:'in-flight',itemId:'a'});f.receive({kind:'outline-navigate',id:'queued',itemId:'b'});await tick();f.receive({kind:'dispose'});waiting.resolve();await tick();
  assert.deepEqual(calls,['a']);assert.equal(f.sent.some(value=>value.kind==='outline-navigated'),false);
});

test('host waits for registration, retains its iframe and accepts only scoped callback acknowledgements',async()=>{
  const f=hostFixture(),navigation=f.mounted.navigateOutline('child-2');let completed=false;navigation.then(()=>{completed=true;});await tick();assert.equal(f.sent.length,0);
  f.receive({kind:'registered'});await tick();const message=f.sent.at(-1);assert.deepEqual(message,{kind:'outline-navigate',id:'outline-host-3',itemId:'child-2',channel:'quizforge-host',session:'outline-host-1'});
  for(const scope of [{source:{}},{session:'stale-frame'}])f.receive({kind:'outline-navigated',id:message.id,ok:true},scope);await tick();assert.equal(completed,false);
  f.receive({kind:'outline-navigated',id:message.id,ok:true});await navigation;assert.equal(f.frame.removed,undefined);assert.equal(f.timers.size,0);f.mounted.destroy();
});

test('host preserves callback errors, releases timeout requests and rejects navigation after disposal',async()=>{
  const f=hostFixture();f.receive({kind:'registered'});await f.mounted.ready;
  const failure=f.mounted.navigateOutline('missing'),rejected=assert.rejects(failure,error=>error.code==='OUTLINE_ITEM_NOT_FOUND'&&error.message==='找不到子题');await tick();f.receive({kind:'outline-navigated',id:f.sent.at(-1).id,ok:false,error:{code:'OUTLINE_ITEM_NOT_FOUND',message:'找不到子题'}});await rejected;assert.equal(f.timers.size,0);
  const timeout=f.mounted.navigateOutline('slow'),timedOut=assert.rejects(timeout,error=>error.code==='OUTLINE_TIMEOUT');await tick();const request=f.sent.at(-1),[timerId,callback]=f.timers.entries().next().value;f.timers.delete(timerId);callback();await timedOut;
  f.receive({kind:'outline-navigated',id:request.id,ok:true});assert.equal(f.timers.size,0);
  const closing=f.mounted.navigateOutline('closing'),closed=assert.rejects(closing,error=>error.code==='PAGE_CLOSED');await tick();f.mounted.destroy();await closed;assert.equal(f.timers.size,0);
  const count=f.sent.length;await assert.rejects(f.mounted.navigateOutline('after-close'),error=>error.code==='PAGE_CLOSED');assert.equal(f.sent.length,count);
});

test('host rejects invalid identifiers and frozen API 1.0 without sending navigation messages',async()=>{
  const f=hostFixture(0);f.receive({kind:'registered'});await f.mounted.ready;
  for(const itemId of ['',{},'x'.repeat(129),'bad\u0000id','bad\u009fid','<tag>'])await assert.rejects(f.mounted.navigateOutline(itemId),error=>error.code==='INVALID_OUTLINE_ITEM');
  await assert.rejects(f.mounted.navigateOutline('valid'),error=>error.code==='OUTLINE_UNAVAILABLE');assert.equal(f.sent.length,0);assert.equal(f.timers.size,0);f.mounted.destroy();
  const pending=hostFixture(),beforeReady=pending.mounted.navigateOutline('valid'),closed=assert.rejects(beforeReady,error=>error.code==='PAGE_CLOSED');pending.mounted.destroy();await closed;
});
