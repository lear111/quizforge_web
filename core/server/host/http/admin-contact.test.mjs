import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {QuizForgeServer} from './server.js';
import {readAdminContact,ADMIN_CONTACT_URL,ADMIN_CONTACT_MAX_BYTES} from './admin-contact.js';

const response=value=>new Response(JSON.stringify(value));
const failure={code:'ADMIN_CONTACT_UNAVAILABLE',message:'暂时无法读取联系方式，请重试。'};

test('contact reads the fixed public HTTPS URL anonymously on every request and strips extra fields',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});return response({content:'测试邮箱\nuser@example.test',revision:calls.length,extra:'not forwarded'});};
  assert.deepEqual(await readAdminContact({fetchImpl}),{content:'测试邮箱\nuser@example.test',revision:1});
  assert.equal((await readAdminContact({fetchImpl})).revision,2);
  for(const {url,options} of calls){
    assert.equal(url,ADMIN_CONTACT_URL);assert.equal(url,'https://quizforge.treenewbee.cloud/api/admin-contact');
    assert.deepEqual(options.headers,{Accept:'application/json'});assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');
    assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.body,undefined);assert.equal(options.dispatcher,undefined);
  }
});

test('contact validates JSON, UTF-16 length and safe nonnegative revisions without leaking upstream errors',async()=>{
  for(const value of [null,[],{content:1,revision:0},{content:'x'},{content:'x',revision:-1},{content:'x',revision:1.5},{content:'x',revision:Number.MAX_SAFE_INTEGER+1},{content:'😀'.repeat(2001),revision:1}]){
    await assert.rejects(readAdminContact({fetchImpl:async()=>response(value)}),failure);
  }
  assert.equal((await readAdminContact({fetchImpl:async()=>response({content:'😀'.repeat(2000),revision:0})})).content.length,4000);
  assert.deepEqual(await readAdminContact({fetchImpl:async()=>response({content:'',revision:0})}),{content:'',revision:0});
  for(const raw of ['not json',new Uint8Array([0xff,0xfe])])await assert.rejects(readAdminContact({fetchImpl:async()=>new Response(raw)}),failure);
  await assert.rejects(readAdminContact({fetchImpl:async()=>{throw Error('private upstream diagnostics');}}),failure);
});

test('contact rejects redirects, bad status, declared and streamed oversized bodies',async()=>{
  let calls=0;
  await assert.rejects(readAdminContact({fetchImpl:async()=>{calls++;return Response.redirect('https://example.test/private',302);}}),failure);
  assert.equal(calls,1);
  await assert.rejects(readAdminContact({fetchImpl:async()=>new Response('upstream',{status:503})}),failure);
  await assert.rejects(readAdminContact({fetchImpl:async()=>new Response('{}',{headers:{'Content-Length':String(ADMIN_CONTACT_MAX_BYTES+1)}})}),failure);
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(20000));controller.enqueue(new Uint8Array(20000));controller.close();}});
  await assert.rejects(readAdminContact({fetchImpl:async()=>new Response(body)}),failure);
});

test('contact deadlines include stalled bodies and callers can cancel before or during a read',async()=>{
  const blocked=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
  await assert.rejects(readAdminContact({fetchImpl:blocked,timeoutMs:20}),{code:'ADMIN_CONTACT_TIMEOUT'});
  await assert.rejects(readAdminContact({timeoutMs:20,fetchImpl:async(_url,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(Error('aborted')),{once:true});}}))}),{code:'ADMIN_CONTACT_TIMEOUT'});
  const controller=new AbortController(),pending=readAdminContact({signal:controller.signal,fetchImpl:blocked});controller.abort();
  await assert.rejects(pending,{code:'ADMIN_CONTACT_CANCELLED'});
  await assert.rejects(readAdminContact({signal:controller.signal,fetchImpl:()=>assert.fail('already cancelled')}),{code:'ADMIN_CONTACT_CANCELLED'});
});

const codeRoot=fileURLToPath(new URL('../../../',import.meta.url)),base=path.resolve(codeRoot,'../.temp/admin-contact-http');
async function host(t,fetchImpl){
  fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'host-'));
  fs.mkdirSync(path.join(root,'question-banks'));fs.mkdirSync(path.join(root,'extensions'));
  const service=await QuizForgeServer.create({root,codeRoot,port:0,token:'local-test-session',tailscale:{read:async()=>({state:'missing'})},adminContact:{fetchImpl}});
  await service.start();
  t.after(async()=>{await service.close();assert.ok(root.startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  const api=(suffix='',options={})=>fetch(`http://127.0.0.1:${service.port()}/api/settings/admin-contact${suffix}`,{headers:{'X-QuizForge-Token':'local-test-session'},...options});
  return {service,api};
}

test('same-origin route keeps existing local authentication, accepts only GET without parameters, and never needs a Hub account',async t=>{
  let calls=0;const {api,service}=await host(t,async()=>{calls++;return response({content:'example.test',revision:calls});});
  assert.equal((await api('',{headers:{}})).status,401);assert.equal(calls,0);
  for(const method of ['POST','PUT','DELETE'])assert.equal((await api('',{method})).status,405);
  assert.equal((await api('?url=https://example.test/')).status,400);assert.equal(calls,0);
  const withBody=await new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:service.port(),path:'/api/settings/admin-contact',method:'GET',headers:{'X-QuizForge-Token':'local-test-session','Content-Length':2}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('{}');});
  assert.equal(withBody,400);assert.equal(calls,0);
  await assert.rejects(service.api({remote:true,request:{method:'GET',headers:{}},url:new URL('http://localhost/api/settings/admin-contact')},'/api/settings/admin-contact'),{code:'LOCAL_SETTINGS_ONLY'});
  const result=await api();assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
  assert.deepEqual(await result.json(),{content:'example.test',revision:1});assert.equal(service.hub.token(),null);
  assert.equal((await (await api()).json()).revision,2);
});

test('disconnecting the local contact request cancels the upstream fetch',async t=>{
  let enter,aborted;const entered=new Promise(resolve=>enter=resolve),cancelled=new Promise(resolve=>aborted=resolve);
  const {service}=await host(t,(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>{aborted();reject(Error('aborted'));},{once:true});enter();}));
  const request=http.get({host:'127.0.0.1',port:service.port(),path:'/api/settings/admin-contact',headers:{'X-QuizForge-Token':'local-test-session'}});request.on('error',()=>{});
  await entered;request.destroy();
  await Promise.race([cancelled,new Promise((_resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Upstream not cancelled')),1000);timer.unref();})]);
});
