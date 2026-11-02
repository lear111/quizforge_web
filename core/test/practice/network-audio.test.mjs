import test from 'node:test';
import assert from 'node:assert/strict';
import {readNetworkAudio, MAX_NETWORK_AUDIO_BYTES} from '../../web/listening/network-audio.js';

const url='https://media.example.test/audio.mp3';
const response=(bytes='ID3-demo',headers={})=>new Response(bytes,{headers:{'Content-Type':'audio/mpeg',...headers}});
test('remote audio is anonymously fetched in full without host headers, cookies, redirects or referrer',async()=>{
  let options;const blob=await readNetworkAudio(url,{fetchImpl:async(address,init)=>{assert.equal(address,url);options=init;return response();}});
  assert.equal(await blob.text(),'ID3-demo');assert.equal(blob.type,'audio/mpeg');assert.equal(MAX_NETWORK_AUDIO_BYTES,64*1024*1024);
  assert.equal(options.method,'GET');assert.equal(options.mode,'cors');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'default');assert.deepEqual(options.headers,{Accept:'audio/*'});
});
test('invalid URLs and unsuccessful, partial, non-audio or empty responses are rejected',async()=>{
  for(const address of ['http://media.example.test/a.mp3','https://user:pass@media.example.test/a.mp3','https://media.example.test/a.mp3#x','file:///a.mp3'])await assert.rejects(readNetworkAudio(address,{fetchImpl:()=>assert.fail('invalid URL fetched')}));
  for(const make of [()=>new Response('no',{status:404}),()=>new Response('partial',{status:206,headers:{'Content-Type':'audio/mpeg'}}),()=>response('x',{'Content-Type':'text/html'}),()=>response('')])await assert.rejects(readNetworkAudio(url,{fetchImpl:async()=>make()}));
});
test('declared and streamed byte limits cancel the body even when content length is absent or understated',async()=>{
  for(const length of [undefined,'999','1']){
    let cancelled=false,reads=0;
    const body=new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array(5));},cancel(){cancelled=true;}});
    const pending=readNetworkAudio(url,{maxBytes:8,fetchImpl:async()=>new Response(body,{headers:{'Content-Type':'audio/mpeg',...(length?{'Content-Length':length}:{})}})});
    await assert.rejects(pending,/64 MiB|大小|上限/);assert.equal(cancelled,true);assert.ok(reads<5);
  }
});
test('timeout and caller cancellation terminate pending fetch and pending body reads',async()=>{
  for(const phase of ['fetch','body']){
    let signal,cancelled=false;
    const fetchImpl=async(address,options)=>{signal=options.signal;return phase==='fetch'?new Promise(()=>{}):new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/mpeg'}});};
    await assert.rejects(readNetworkAudio(url,{timeoutMs:20,fetchImpl}),/超时/);assert.equal(signal.aborted,true);if(phase==='body')assert.equal(cancelled,true);
    const controller=new AbortController(),pending=readNetworkAudio(url,{signal:controller.signal,fetchImpl});controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(signal.aborted,true);
  }
  const controller=new AbortController();controller.abort();await assert.rejects(readNetworkAudio(url,{signal:controller.signal,fetchImpl:()=>assert.fail('aborted request fetched')}),{name:'AbortError'});
});
test('a delayed response is discarded and cancelled after cancellation',async()=>{
  let resolve,cancelled=false;const controller=new AbortController();
  const pending=readNetworkAudio(url,{signal:controller.signal,fetchImpl:()=>new Promise(done=>{resolve=done;})});controller.abort();await assert.rejects(pending,{name:'AbortError'});
  resolve(new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/mpeg'}}));await new Promise(done=>setImmediate(done));assert.equal(cancelled,true);
});
test('explicit retry bypasses the browser HTTP cache and network failures give a useful error',async()=>{
  await readNetworkAudio(url,{reload:true,fetchImpl:async(address,options)=>{assert.equal(options.cache,'reload');return response();}});
  await assert.rejects(readNetworkAudio(url,{fetchImpl:async()=>{throw new TypeError('Failed to fetch');}}),/网络.*跨域/);
});


test('documented v0.8 audit gaps remain explicit: browser has no full host or canonical/length validation',async()=>{
  // Characterization of pending decisions, not approval of these addresses.
  for(const address of ['https://localhost/a.mp3','https://192.0.2.1/a.mp3','https://MEDIA.example.test:443/a.mp3','https://media.example.test/'+ 'a'.repeat(2050)]){
    let called=false;await readNetworkAudio(address,{fetchImpl:async()=>{called=true;return response();}});assert.equal(called,true);
  }
});
