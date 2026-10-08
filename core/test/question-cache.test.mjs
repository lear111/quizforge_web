import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuestionCache} from '../web/question-cache.js';

function fixture(options={}) {
  let time=0;
  const cache=createQuestionCache({now:()=>time,schedule:null,...options});
  return {cache,advance:amount=>{time+=amount;}};
}
function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

test('revisited questions reuse projected answers and ink without sharing mutable state',async()=>{
  const {cache}=fixture(),source={question:{data:{stem:'题目'}},state:{answer:{selectedOptionId:'B'}},draft:{strokes:[{points:[{x:1,y:2}]}]}};
  let loads=0;
  const first=await cache.load('bank:java:q1',async()=>{loads++;return source;});
  first.state.answer.selectedOptionId='A';source.draft.strokes[0].points[0].x=99;
  const second=await cache.load('bank:java:q1',async()=>{loads++;throw new Error('should not fetch');});
  assert.equal(loads,1);assert.equal(second.state.answer.selectedOptionId,'B');assert.equal(second.draft.strokes[0].points[0].x,1);
  second.draft.strokes.length=0;
  assert.equal(cache.get('bank:java:q1').draft.strokes.length,1);
});

test('stamp revalidation gets a copy and publishes changed server state',async()=>{
  const {cache}=fixture();cache.set('q1',{stamp:{revision:1},state:{answer:'A'}});
  const current=await cache.load('q1',async cached=>{assert.equal(cached.stamp.revision,1);cached.state.answer='local';return {stamp:{revision:2},state:{answer:'B'}};},{revalidate:true});
  assert.equal(current.state.answer,'B');assert.equal(cache.get('q1').stamp.revision,2);
});

test('capacity evicts least recently used questions rather than the question just revisited',()=>{
  const {cache}=fixture({capacity:2});cache.set('q1',{id:1});cache.set('q2',{id:2});cache.get('q1');cache.set('q3',{id:3});
  assert.equal(cache.get('q2'),null);assert.deepEqual(cache.get('q1'),{id:1});assert.deepEqual(cache.get('q3'),{id:3});assert.equal(cache.stats().size,2);
});

test('UTF8 budget evicts old payloads, and an oversized response remains usable without retention',async()=>{
  const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const first={stem:'汉字'},second={stem:'third'};
  const {cache}=fixture({maxBytes:bytes(first)+bytes(second)-1});
  cache.set('q1',first);cache.set('q2',second);
  assert.equal(cache.get('q1'),null);assert.equal(cache.stats().bytes,bytes(second));
  const large={stem:'题'.repeat(100)};
  assert.deepEqual(await cache.load('q3',async()=>large),large);
  assert.equal(cache.get('q3'),null);assert.equal(cache.stats().bytes,bytes(second));
});

test('idle TTL renews on revisit and expires at the exact boundary',()=>{
  const {cache,advance}=fixture({ttlMs:100});cache.set('q1',{id:1});advance(90);assert.ok(cache.get('q1'));advance(99);assert.ok(cache.get('q1'));advance(100);
  assert.equal(cache.get('q1'),null);assert.deepEqual(cache.stats(),{size:0,bytes:0,inflight:0});
});

test('timer releases idle payloads even when no question lookup happens',()=>{
  let time=0,scheduled=null;
  const cache=createQuestionCache({ttlMs:100,now:()=>time,schedule:(callback,delay)=>{scheduled={callback,delay};return 1;},cancel:()=>{scheduled=null;}});
  cache.set('q1',{id:1});assert.equal(scheduled.delay,100);time=100;const expiry=scheduled.callback;scheduled=null;expiry();
  assert.equal(scheduled,null);assert.equal(cache.stats().size,0);
});

test('simultaneous requests share one load but receive separate result objects',async()=>{
  const {cache}=fixture(),gate=deferred();let calls=0;
  const loader=()=>{calls++;return gate.promise;};
  const first=cache.load('q1',loader),second=cache.load('q1',loader);
  await Promise.resolve();assert.equal(calls,1);assert.equal(cache.stats().inflight,1);
  gate.resolve({state:{answer:'A'}});const [a,b]=await Promise.all([first,second]);a.state.answer='B';assert.equal(b.state.answer,'A');assert.equal(cache.stats().inflight,0);
});

test('failed loads retain no failure and allow a later retry',async()=>{
  const {cache}=fixture();await assert.rejects(cache.load('q1',async()=>{throw new Error('offline');}),/offline/);
  assert.deepEqual(cache.stats(),{size:0,bytes:0,inflight:0});assert.deepEqual(await cache.load('q1',async()=>({state:{answer:'B'}})),{state:{answer:'B'}});
});

test('failed revalidation leaves the previously confirmed payload available',async()=>{
  const {cache}=fixture();cache.set('q1',{state:{answer:'A'}});
  await assert.rejects(cache.load('q1',async cached=>{cached.state.answer='changed';throw new Error('offline');},{revalidate:true}));
  assert.deepEqual(cache.get('q1'),{state:{answer:'A'}});
});

test('closing one collection releases only its payloads and fences its pending loads',async()=>{
  const {cache}=fixture(),gate=deferred();cache.set('bank:a:q1',{id:1});cache.set('bank:b:q1',{id:2});
  const load=cache.load('bank:a:q2',()=>gate.promise);await Promise.resolve();assert.equal(cache.deleteCollection('bank:a:'),1);
  gate.resolve({id:3});await load;
  assert.equal(cache.get('bank:a:q1'),null);assert.equal(cache.get('bank:a:q2'),null);assert.deepEqual(cache.get('bank:b:q1'),{id:2});
});

test('refresh clears retained data and old loads cannot populate it afterward',async()=>{
  const {cache}=fixture(),old=deferred();cache.set('q1',{id:1});const stale=cache.load('q2',()=>old.promise);await Promise.resolve();cache.clear();
  const fresh=await cache.load('q2',async()=>({id:'new'}));old.resolve({id:'old'});await stale;
  assert.deepEqual(fresh,{id:'new'});assert.deepEqual(cache.get('q2'),{id:'new'});assert.equal(cache.get('q1'),null);
});

test('confirmed writes supersede a slower projected GET result',async()=>{
  const {cache}=fixture(),gate=deferred();const load=cache.load('q1',()=>gate.promise);await Promise.resolve();cache.set('q1',{state:{revision:2,answer:'B'}});gate.resolve({state:{revision:1,answer:'A'}});
  assert.deepEqual(await load,{state:{revision:2,answer:'B'}});assert.equal(cache.get('q1').state.revision,2);
});

test('explicit question invalidation cannot be undone by a pending request',async()=>{
  const {cache}=fixture(),gate=deferred();const load=cache.load('q1',()=>gate.promise);await Promise.resolve();cache.delete('q1');gate.resolve({id:1});await load;assert.equal(cache.get('q1'),null);
});

test('invalid replacement leaves the last confirmed cached value intact',()=>{
  const {cache}=fixture();cache.set('q1',{id:1});assert.throws(()=>cache.set('q1',{value:1n}),TypeError);assert.deepEqual(cache.get('q1'),{id:1});
  assert.throws(()=>createQuestionCache({capacity:0}),RangeError);assert.throws(()=>cache.get(null),TypeError);
});
