import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture(response,overrides={}) {
  const storage=new Map(),events=[],calls=[];
  const sandbox={
    sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},URLSearchParams,
    document:{dispatchEvent:event=>events.push(event.type)},Event,AbortController,setTimeout,clearTimeout,FileReader:class{readAsDataURL(){this.result='data:image/png;base64,aW1hZ2U=';this.onload();}},
    fetch:async(path,options)=>{calls.push({path,options});return response;},...overrides
  };
  const source=readFileSync(new URL('../../web/shared/api.js',import.meta.url),'utf8').replaceAll('export ','');
  vm.runInNewContext(`${source}\nglobalThis.api={request,setAccessToken,readResource};`,sandbox);
  return {...sandbox.api,storage,events,calls};
}

test('load timeouts describe loading while write timeouts retain the saved-input warning',async()=>{
  let expire;
  const f=fixture(null,{setTimeout:callback=>{expire=callback;return 1;},clearTimeout(){},fetch:(_path,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted'))))});
  const read=f.request('/api/collections/bank/demo');expire();await assert.rejects(read,{code:'REQUEST_TIMEOUT',message:'加载等待超时，请稍后重试。'});
  const write=f.request('/api/collections/bank/demo/questions/q/actions',{method:'POST',body:'{}'});expire();await assert.rejects(write,{code:'REQUEST_TIMEOUT',message:'连接等待超时，当前输入已保留，请重试保存。'});
});

test('login exchanges a password without storing it; later requests use only the returned session',async()=>{
  const f=fixture({ok:true,json:async()=>({token:'test-session'})});
  const result=await f.request('/api/auth/login',{method:'POST',body:JSON.stringify({password:'temporary-test-password'})});
  assert.equal(f.storage.size,0);
  f.setAccessToken(result.token);await f.request('/api/catalog');
  assert.equal(f.storage.get('quizforge-access-token'),'test-session');
  assert.equal(f.calls[1].options.headers['X-QuizForge-Token'],'test-session');
  assert.equal(f.calls[0].options.headers['X-QuizForge-Token'],undefined);
});

test('callers can cancel a read without turning it into a timeout or cancelling the next read',async()=>{
  let active;
  const f=fixture(null,{fetch:async(_path,{signal})=>{active=signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
  const controller=new AbortController(),pending=f.request('/api/settings/admin-contact',{signal:controller.signal});controller.abort();
  await assert.rejects(pending,{name:'AbortError',code:'REQUEST_CANCELLED'});assert.equal(active.aborted,true);
  await assert.rejects(f.request('/api/settings/admin-contact',{signal:controller.signal}),{code:'REQUEST_CANCELLED'});
  const success=fixture({ok:true,json:async()=>({ok:true})}),finished=new AbortController();
  assert.equal((await success.request('/api/health',{signal:finished.signal})).ok,true);finished.abort();
  assert.equal(success.calls[0].options.signal.aborted,false,'The listener is detached after completion');
});

test('all requests share a fresh page-only practice session without persisting or accepting an override',async()=>{
  const response={ok:true,json:async()=>({ok:true}),blob:async()=>({size:5,type:'image/png'})},first=fixture(response),second=fixture(response);
  await first.request('/api/catalog');await first.request('/api/collections/bank/demo/summary',{headers:{'X-QuizForge-Practice-Session':'override'}});await first.readResource('a'.repeat(64));await second.request('/api/catalog');
  const session=first.calls[0].options.headers['X-QuizForge-Practice-Session'];assert.match(session,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.equal(first.calls[1].options.headers['X-QuizForge-Practice-Session'],session);assert.equal(first.calls[2].options.headers['X-QuizForge-Practice-Session'],session);assert.notEqual(second.calls[0].options.headers['X-QuizForge-Practice-Session'],session);assert.equal(first.storage.size,0);assert.equal(second.storage.size,0);
});

test('expired session opens reconnect without replaying writes, while failed login stays in its own form',async()=>{
  const f=fixture({ok:false,status:401,json:async()=>({error:{code:'TOKEN_REQUIRED',message:'Reconnect'}})});
  await assert.rejects(f.request('/api/collections/bank/demo/finish',{method:'POST',body:'{}'}),error=>error.status===401);
  assert.deepEqual(f.events,['quizforge-auth-required']);assert.equal(f.calls.length,1);
  await assert.rejects(f.request('/api/auth/login',{method:'POST',body:'{}'}),error=>error.status===401);
  assert.deepEqual(f.events,['quizforge-auth-required']);
});

test('qbank transfers keep binary upload headers and return the download blob',async()=>{
  const blob=new Blob(['package']),f=fixture({ok:true,blob:async()=>blob,json:async()=>({ok:true})});
  await f.request('/api/library/import',{method:'POST',body:blob,headers:{'Content-Type':'application/vnd.quizforge.qbank'}});
  assert.equal(f.calls[0].options.body,blob);assert.equal(f.calls[0].options.headers['Content-Type'],'application/vnd.quizforge.qbank');
  assert.equal(await f.request('/api/library/export',{method:'POST',body:'{}',responseType:'blob'}),blob);
  assert.equal(f.calls[1].options.headers.Accept,'application/vnd.quizforge.qbank');assert.equal(f.calls[1].options.responseType,undefined);
});
