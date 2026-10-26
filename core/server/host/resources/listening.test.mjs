import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {QuizForgeServer} from '../http/server.js';
import {readListening,readQuestionListening,readMaterial} from './listening.js';
const product=fileURLToPath(new URL('../../../../',import.meta.url)),codeRoot=path.join(product,'core');
const raw=()=>JSON.parse(fs.readFileSync(path.join(product,'question-banks/基础题型/听力组件演示/bank.json'),'utf8'));
test('listening declarations reject external paths, duplicate identities, unknown bindings and unsupported fields',()=>{
  assert.equal(readListening({}),null);const bank=raw(),config=readListening(bank);assert.equal(readQuestionListening(bank.questions[0],config).materialId,'library');
  for(const file of ['https://example.test/a.mp3','media/../secret.mp3','media/a/clip.mp3','media\\clip.mp3','media/clip.html'])assert.throws(()=>readListening({listening:{materials:[{id:'one',title:'One',file}]}}));
  assert.throws(()=>readListening({listening:{materials:[config.materials[0],config.materials[0]]}}));
  assert.throws(()=>readQuestionListening({listening:{materialId:'missing'}},config));
  assert.throws(()=>readQuestionListening({listening:{materialId:'library',url:'x'}},config));
});
async function fixture(t,{history=true,token=null}={}){
  const base=path.join(product,'.temp/listening-tests');fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'host-'));
  fs.cpSync(path.join(product,'extensions/基础题型/单选题'),path.join(root,'extensions/基础题型/单选题'),{recursive:true});fs.cpSync(path.join(product,'question-banks/基础题型/听力组件演示'),path.join(root,'question-banks/基础题型/听力组件演示'),{recursive:true});
  const bankFile=path.join(root,'question-banks/基础题型/听力组件演示/bank.json'),bank=raw();bank.features.history=history;fs.writeFileSync(bankFile,JSON.stringify(bank));
  const service=await QuizForgeServer.create({root,codeRoot,port:0,token,tailscale:{read:async()=>({state:'missing'})}});service.engine.validationEnvironment=async()=>'listening-test';await service.start();
  t.after(async()=>{await service.close();assert.equal(path.dirname(root),base);fs.rmSync(root,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${service.port()}`,headers={'Content-Type':'application/json','X-QuizForge-Practice-Session':'bfa43429-29b5-4bbf-b4b9-59af9e3d14a9',...(token?{'X-QuizForge-Token':token}:{})};
  const api=async(url,body,method=body?'POST':'GET')=>{const response=await fetch(origin+url,{method,headers,body:body?JSON.stringify(body):undefined});const data=response.headers.get('content-type')?.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());return {status:response.status,data,headers:response.headers};};
  const catalog=(await api('/api/library/index')).data,collection=`/api/collections/bank/${catalog.banks[0].id}`;
  return {root,service,origin,headers,api,collection,bankFile};
}
test('authenticated binary audio, actual answers and edits work without leaking paths or changing binding',async t=>{
  const f=await fixture(t,{token:'listening-test-token-123'}),overview=await f.api(f.collection);assert.equal(overview.status,200);assert.equal(overview.data.questions[0].listening.materialId,'library');assert.equal(overview.data.listening.materials[0].file,undefined);
  assert.equal((await fetch(f.origin+f.collection+'/listening/library')).status,401);
  const audio=await f.api(f.collection+'/listening/library');assert.equal(audio.status,200);assert.equal(audio.headers.get('content-type'),'audio/mpeg');assert.ok(audio.data.length>100000);assert.equal((await f.api(f.collection+'/listening/missing')).status,404);
  const uri=f.collection+'/questions/library-hours',question=(await f.api(uri)).data;
  const result=await f.api(uri+'/actions',{requestId:'listen-submit-real',revision:question.state.revision,contentVersion:question.stamp.contentVersion,action:'submit',data:{answer:{selectedOptionId:'choice-4'}}});assert.equal(result.status,200);assert.equal(result.data.state.result.score,5);
  const editor=(await f.api(uri+'/editor')).data;
  const edited=await f.api(uri+'/edit',{requestId:'listen-edit-real',revision:editor.revision,contentVersion:editor.contentVersion,sourceVersion:editor.sourceVersion,title:'已编辑的听力题',data:editor.question.data});assert.equal(edited.status,200,JSON.stringify(edited.data));assert.equal(edited.data.collection.questions[0].listening.materialId,'library');assert.equal(edited.data.payload.state.result.score,5);
});
test('single-bank export and duplicate import preserve bank-local audio and exact extension references',async t=>{
  const f=await fixture(t),row=(await f.api('/api/library/index')).data.banks[0];
  const response=await fetch(f.origin+'/api/library/export',{method:'POST',headers:f.headers,body:JSON.stringify({bank:row.path})});assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());
  const imported=await f.service.library.importPackage(bytes,'听力演示副本.qbank');assert.ok(imported.catalog.banks.length===2);const copy=imported.catalog.banks.find(bank=>bank.id!==row.id),collection=await f.service.library.collection('bank',copy.id);assert.equal(collection.questions[0].listening.materialId,'library');assert.deepEqual(readMaterial(collection,'library').bytes,fs.readFileSync(path.join(f.root,'question-banks/基础题型/听力组件演示/media/library.mp3')));
  await f.service.library.manage({kind:'bank',target:'group',action:'create',name:'新听力分组'});
  await f.service.library.manage({kind:'bank',target:'item',action:'update',path:copy.path,name:'移动后的听力题库',group:'新听力分组'});
  const moved=await f.service.library.collection('bank',copy.id);assert.deepEqual(readMaterial(moved,'library').bytes,audioBytes());
  function audioBytes(){return fs.readFileSync(path.join(f.root,'question-banks/基础题型/听力组件演示/media/library.mp3'));}
});
test('exam audio and bindings survive source replacement and service restart',async t=>{
  const f=await fixture(t),started=(await f.api(f.collection+'/exams',{requestId:'listen-exam-snapshot',durationMinutes:null})).data,uri=`/api/collections/exam/${started.id}`;
  const before=await f.api(uri+'/listening/exam');assert.equal(before.status,200);const meta=(await f.api(uri)).data;assert.equal(meta.listening.examMaterialId,'exam');assert.equal(meta.questions[1].listening.materialId,'library');
  fs.writeFileSync(path.join(f.root,'question-banks/基础题型/听力组件演示/media/exam.mp3'),'broken source');await f.service.close();
  const service=await QuizForgeServer.create({root:f.root,codeRoot,port:0,tailscale:{read:async()=>({state:'missing'})}});await service.start();t.after(()=>service.close());const response=await fetch(`http://127.0.0.1:${service.port()}${uri}/listening/exam`,{headers:f.headers});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),before.data);
});
test('temporary exam audio enforces page ownership and is removed with its own snapshot',async t=>{
  const f=await fixture(t,{history:false}),started=(await f.api(f.collection+'/exams',{requestId:'listen-temporary-exam',durationMinutes:null})).data,uri=`/api/collections/exam/${started.id}`;
  const wrong=await fetch(f.origin+uri+'/listening/exam',{headers:{...f.headers,'X-QuizForge-Practice-Session':'84bfc815-29b5-4bbf-b4b9-59af9e3d14a9'}});assert.notEqual(wrong.status,200);assert.equal((await f.api(uri+'/listening/exam')).status,200);assert.equal((await f.api(uri+'/exam',undefined,'DELETE')).status,200);assert.equal(fs.existsSync(path.join(f.root,'.state/exams',started.id)),false);
});
