import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture(response) {
  const storage=new Map(),events=[],calls=[];
  const sandbox={
    sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},URLSearchParams,
    document:{dispatchEvent:event=>events.push(event.type)},Event,AbortController,setTimeout,clearTimeout,FileReader:class{readAsDataURL(){this.result='data:image/png;base64,aW1hZ2U=';this.onload();}},
    fetch:async(path,options)=>{calls.push({path,options});return response;}
  };
  const source=readFileSync(new URL('../web/api.js',import.meta.url),'utf8').replaceAll('export ','');
  vm.runInNewContext(`${source}\nglobalThis.api={request,setAccessToken,readResource};`,sandbox);
  return {...sandbox.api,storage,events,calls};
}

test('login exchanges a password without storing it; later requests use only the returned session',async()=>{
  const f=fixture({ok:true,json:async()=>({token:'test-session'})});
  const result=await f.request('/api/auth/login',{method:'POST',body:JSON.stringify({password:'temporary-test-password'})});
  assert.equal(f.storage.size,0);
  f.setAccessToken(result.token);await f.request('/api/catalog');
  assert.equal(f.storage.get('quizforge-access-token'),'test-session');
  assert.equal(f.calls[1].options.headers['X-QuizForge-Token'],'test-session');
  assert.equal(f.calls[0].options.headers['X-QuizForge-Token'],undefined);
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
