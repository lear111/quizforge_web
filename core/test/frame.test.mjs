import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {bootstrapV1} from '../web/api-v1.js';
import {resolveExtensionApi} from '../web/api-bridges.js';

const frameSource=readFileSync(new URL('../web/frame.js',import.meta.url),'utf8');
const bootstrapSource=bootstrapV1.toString();
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('flush invokes unsent-input hook and propagates failures to the host',async()=>{
  const fixture=iframeFixture();let flushed=0;
  await fixture.QF.page.register({onLoad(){},onFlush(){flushed++;throw new Error('图片上传尚未保存');}});
  fixture.receive({kind:'flush',id:'pending-upload'});await tick();
  assert.equal(flushed,1);
  const reply=fixture.sent.find(value=>value.kind==='flushed');assert.equal(reply.ok,false);assert.match(reply.error.message,/图片上传/);
  const host=hostFixture();host.receive({kind:'registered'});await host.mounted.ready;
  const saving=host.mounted.flush();host.receive({kind:'flushed',id:host.sent.at(-1).id,ok:false,error:{message:'保存失败'}});
  await assert.rejects(saving,/保存失败/);host.mounted.destroy();fixture.receive({kind:'dispose'});
});

test('editor restores and exports incomplete draft independently of valid-document reads',async()=>{
  const fixture=iframeFixture({mode:'edit'});let restored=null,disposed=0;
  await fixture.QF.editor.register({onLoad(){},getDocument(){throw new Error('题干为空');},exportDraft:()=>({title:'',stem:''}),importDraft:value=>{restored=value;},hasChanges:()=>true,onDispose(){disposed++;}});
  fixture.receive({kind:'read-draft',id:'incomplete'});await tick();
  const reply=fixture.sent.find(value=>value.kind==='editor-draft');assert.equal(reply.supported,true);assert.deepEqual(reply.draft,{title:'',stem:''});assert.equal(reply.changed,true);
  fixture.receive({kind:'dispose'});assert.equal(disposed,1);assert.equal(restored,null);
});

// Run the actual iframe bootstrap. The fixture supplies message transport and fake
// timers only, so request tracking, scope checks and flush behavior stay production code.
function iframeFixture(context={question:{id:'q1'}},bootOptions={}) {
  const listeners=new Map(),sent=[],timers=new Map();
  let nextTimer=0;
  const parent={postMessage:message=>sent.push(structuredClone(message))};
  const sandbox={
    parent,Promise,structuredClone,
    document:{body:{scrollHeight:100},documentElement:{scrollHeight:100}},
    ResizeObserver:class {observe(){}},
    setTimeout(callback){const id=++nextTimer;timers.set(id,callback);return id;},
    clearTimeout:id=>timers.delete(id),
    addEventListener:(name,callback)=>listeners.set(name,callback),
  };
  const boot={session:'iframe-session',context,api:resolveExtensionApi().api,...bootOptions};
  vm.runInNewContext(`(${bootstrapSource})(${JSON.stringify(boot)});`,sandbox);
  const receive=(value,{source=parent,session='iframe-session'}={})=>listeners.get('message')({source,data:{...value,channel:'quizforge-host',session}});
  return {QF:sandbox.QF,sent,timers,parent,receive,document:sandbox.document,dispatch:name=>listeners.get(name)?.({})};
}

function hostFixture(context={question:{id:'q1'}}) {
  const listeners=new Map(),timers=new Map(),sent=[],requests=[],layouts=[];
  let nextId=0,nextTimer=0;
  const frame={
    style:{},attributes:{},removed:false,
    contentWindow:{postMessage:message=>sent.push(structuredClone(message))},
    setAttribute(name,value){this.attributes[name]=value;},
    remove(){this.removed=true;},
  };
  const sandbox={
    Promise,structuredClone,
    makeRequestId:()=>`fixture-${++nextId}`,
    resolveExtensionApi,
    document:{createElement:()=>frame},
    window:{addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name)},
    setTimeout(callback){const id=++nextTimer;timers.set(id,callback);return id;},
    clearTimeout:id=>timers.delete(id),
  };
  // Remove the module boundary without replacing any frame behavior. api.js needs
  // browser storage, while this test supplies only its request-ID dependency.
  const moduleSource=frameSource.replace(/^import[^\r\n]*\r?\n/gm,'').replace('export function mountExtension','function mountExtension');
  vm.runInNewContext(`${moduleSource}\nglobalThis.mountExtension=mountExtension;`,sandbox);
  const mounted=sandbox.mountExtension({append(){}},{html:'<div></div>',script:'',style:''},context,{
    onRequest(method,args){requests.push({method,args});return {ok:true,data:{status:'draft'}};},
    onLayout(options,owner){layouts.push({options,owner});},
    onError(message){throw new Error(message);},
  });
  mounted.ready.catch(()=>{});
  const receive=(value,{source=frame.contentWindow,session='fixture-1'}={})=>listeners.get('message')?.({source,data:{...value,channel:'quizforge-extension',session}});
  return {mounted,frame,sent,requests,layouts,timers,receive};
}

test('advanced editor preserves the iframe and restores its normal size on close and disposal',async()=>{
  const f=hostFixture({mode:'edit',capabilities:{canEdit:true}});f.receive({kind:'registered'});await f.mounted.ready;
  f.receive({kind:'resize',height:730});
  f.receive({kind:'request',id:'expand',method:'editor-layout',args:{expanded:true,contentWidth:612}});await tick();
  assert.equal(f.layouts[0].owner,f.frame);assert.equal(f.frame.style.height,'100dvh');assert.equal(f.frame.removed,false);assert.equal(f.sent.at(-1).reply.ok,true);
  f.receive({kind:'resize',height:9000});assert.equal(f.frame.style.height,'100dvh');
  f.receive({kind:'request',id:'collapse',method:'editor-layout',args:{expanded:false}});await tick();assert.equal(f.frame.style.height,'730px');
  f.receive({kind:'request',id:'again',method:'editor-layout',args:{expanded:true,contentWidth:612}});await tick();f.mounted.destroy();
  assert.equal(f.layouts.at(-1).options.expanded,false);assert.equal(f.frame.removed,true);
});

test('read-only history and invalid geometry cannot open an editable workspace',async()=>{
  const history=hostFixture({mode:'history',capabilities:{canSave:false}});history.receive({kind:'registered'});await history.mounted.ready;
  history.receive({kind:'request',id:'expand',method:'editor-layout',args:{expanded:true,contentWidth:612}});await tick();assert.equal(history.sent.at(-1).reply.error.code,'READ_ONLY');assert.equal(history.layouts.length,0);history.mounted.destroy();
  const edit=hostFixture({mode:'edit',capabilities:{canEdit:true}});edit.receive({kind:'registered'});await edit.mounted.ready;
  edit.receive({kind:'request',id:'invalid',method:'editor-layout',args:{expanded:true,contentWidth:Infinity}});await tick();assert.equal(edit.sent.at(-1).reply.error.code,'INVALID_REQUEST');assert.equal(edit.layouts.length,0);edit.mounted.destroy();
});

test('flush drains a newer draft started while an earlier save is pending',async(t)=>{
  const fixture=iframeFixture();
  t.after(()=>fixture.receive({kind:'dispose'}));
  await fixture.QF.page.register({onLoad(){}});
  fixture.sent.length=0;
  const first=fixture.QF.save({purpose:'draft',data:{answer:{selectedOptionId:'A'}}});
  fixture.receive({kind:'flush',id:'leave-question'});
  const second=fixture.QF.save({purpose:'draft',data:{answer:{selectedOptionId:'B'}}});
  const requestIds=fixture.sent.filter(value=>value.kind==='request').map(value=>value.id);
  assert.equal(requestIds.length,2);

  fixture.receive({kind:'reply',id:requestIds[0],reply:{ok:true,data:{status:'draft'}}});
  await first;
  await tick();
  assert.equal(fixture.sent.some(value=>value.kind==='flushed'),false,'An older pending snapshot would incorrectly acknowledge flush here');

  fixture.receive({kind:'reply',id:requestIds[1],reply:{ok:true,data:{status:'draft'}}});
  await second;
  await tick();
  assert.deepEqual(fixture.sent.filter(value=>value.kind==='flushed').map(value=>value.id),['leave-question']);
  assert.equal(fixture.timers.size,0);
});

test('iframe rejects foreign-source and mismatched-session replies, contexts and disposal',async(t)=>{
  const fixture=iframeFixture(),contexts=[];
  t.after(()=>fixture.receive({kind:'dispose'}));
  await fixture.QF.page.register({onLoad:context=>{contexts.push(context);}});
  const pending=fixture.QF.save({purpose:'draft',data:{answer:{selectedOptionId:'A'}}});
  const request=fixture.sent.find(value=>value.kind==='request');
  let settled=false;
  pending.then(()=>{settled=true;});
  for(const scope of [{source:{}},{session:'another-session'}]) {
    fixture.receive({kind:'reply',id:request.id,reply:{ok:true}},scope);
    fixture.receive({kind:'context',context:{question:{id:'forged-question'}}},scope);
    fixture.receive({kind:'dispose'},scope);
    fixture.receive({kind:'flush',id:'forged-flush'},scope);
  }
  await tick();
  assert.equal(settled,false);
  assert.deepEqual(contexts.map(value=>value.question.id),['q1']);
  assert.equal(fixture.sent.some(value=>value.kind==='flushed'),false);

  fixture.receive({kind:'reply',id:request.id,reply:{ok:true}});
  assert.equal((await pending).ok,true);
  const retry=fixture.QF.requestAction({action:'retry'});
  assert.equal(fixture.sent.filter(value=>value.kind==='request').length,2,'Spoofed disposal must not close the SDK');
  fixture.receive({kind:'context',context:{question:{id:'confirmed-question'}}});
  fixture.receive({kind:'dispose'});
  assert.equal((await retry).error.code,'PAGE_CLOSED');
  assert.equal(contexts.at(-1).question.id,'confirmed-question');
});

test('dispose resolves outstanding SDK requests and rejects new requests without sending',async()=>{
  const fixture=iframeFixture();
  await fixture.QF.page.register({onLoad(){}});
  const saving=fixture.QF.save({purpose:'draft',data:{answer:{selectedOptionId:'B'}}});
  const retrying=fixture.QF.requestAction({action:'retry'});
  fixture.receive({kind:'flush',id:'closing'});
  assert.equal(fixture.timers.size,2);

  fixture.receive({kind:'dispose'});
  assert.deepEqual((await Promise.all([saving,retrying])).map(reply=>[reply.ok,reply.error.code]),[[false,'PAGE_CLOSED'],[false,'PAGE_CLOSED']]);
  await tick();
  assert.equal(fixture.timers.size,0);
  assert.equal(fixture.sent.some(value=>value.kind==='flushed'&&value.id==='closing'),true);
  const sentCount=fixture.sent.length;
  const closedReply=await fixture.QF.save({purpose:'submit',data:{answer:{selectedOptionId:'B'}}});
  assert.equal(closedReply.error.code,'PAGE_CLOSED');
  assert.equal(fixture.sent.length,sentCount);
});

test('host rejects foreign-source and mismatched-session registration, requests and flush replies',async(t)=>{
  const fixture=hostFixture();
  t.after(()=>fixture.mounted.destroy());
  let ready=false;
  fixture.mounted.ready.then(()=>{ready=true;});
  for(const scope of [{source:{}},{session:'another-session'}]) {
    fixture.receive({kind:'registered'},scope);
    fixture.receive({kind:'request',id:'forged-request',method:'save',args:{purpose:'draft',data:{answer:'B'}}},scope);
    fixture.receive({kind:'resize',height:900},scope);
  }
  await tick();
  assert.equal(ready,false);
  assert.equal(fixture.requests.length,0);
  assert.equal(fixture.frame.style.height,undefined);
  fixture.receive({kind:'registered'});
  await fixture.mounted.ready;
  fixture.receive({kind:'request',id:'valid-request',method:'save',args:{purpose:'draft',data:{answer:'A'}}});
  await tick();
  assert.equal(fixture.requests.length,1);
  assert.equal(fixture.sent.find(value=>value.kind==='reply').id,'valid-request');

  let flushed=false;
  const flushing=fixture.mounted.flush().then(()=>{flushed=true;});
  const id=fixture.sent.find(value=>value.kind==='flush').id;
  fixture.receive({kind:'flushed',id},{source:{}});
  fixture.receive({kind:'flushed',id},{session:'another-session'});
  await tick();
  assert.equal(flushed,false);
  fixture.receive({kind:'flushed',id});
  await flushing;
  assert.equal(flushed,true);
});

test('host destroy releases pending flush barriers and removes its listener',async()=>{
  const fixture=hostFixture();
  fixture.receive({kind:'registered'});
  await fixture.mounted.ready;
  const flushing=fixture.mounted.flush();
  fixture.mounted.destroy();
  await flushing;
  assert.equal(fixture.frame.removed,true);
  assert.equal(fixture.timers.size,0);
  const count=fixture.requests.length;
  fixture.receive({kind:'request',id:'late-request',method:'save',args:{}});
  await tick();
  assert.equal(fixture.requests.length,count);
  assert.equal(fixture.sent.at(-1).kind,'dispose');
});

test('editor registration loads raw context and checkOnly reads dirtiness without validating content',async(t)=>{
  const context={mode:'edit',question:{id:'q1',title:'题名',data:{correctOptionId:'B'}},capabilities:{canEdit:true}};
  const fixture=iframeFixture(context);
  t.after(()=>fixture.receive({kind:'dispose'}));
  let loaded,getDocumentCalls=0;
  const document={title:'修改后的题名',data:{correctOptionId:'A'}};
  await fixture.QF.editor.register({
    onLoad:value=>{loaded=value;},
    hasChanges:()=>true,
    getDocument(){getDocumentCalls++;return document;}
  });
  assert.deepEqual(structuredClone(loaded),context);
  assert.equal(fixture.sent.filter(value=>value.kind==='registered').length,1);
  loaded.question.data.correctOptionId='local mutation';
  assert.equal(context.question.data.correctOptionId,'B','Extension context must be a copy.');

  fixture.receive({kind:'read-document',id:'dirty-check',checkOnly:true});
  await tick();
  assert.equal(getDocumentCalls,0,'Leaving an unchanged/invalid editor must not run save validation.');
  const checkReply=fixture.sent.find(value=>value.kind==='document'&&value.id==='dirty-check');
  assert.equal(checkReply.ok,true);
  assert.equal(checkReply.changed,true);
  assert.equal(checkReply.document,undefined);

  fixture.receive({kind:'read-document',id:'save-document'});
  await tick();
  assert.equal(getDocumentCalls,1);
  const reply=fixture.sent.find(value=>value.kind==='document'&&value.id==='save-document');
  assert.deepEqual(reply.document,document);
  document.title='later change';
  assert.equal(reply.document.title,'修改后的题名','The document reply must capture a clone.');
});

test('editor registration requires edit mode and an actual document reader',async()=>{
  const practice=iframeFixture();
  assert.throws(()=>practice.QF.editor.register({onLoad(){},getDocument(){}}),/不是编辑模式/);
  practice.receive({kind:'dispose'});
  const editor=iframeFixture({mode:'edit',question:{id:'q1'}});
  assert.throws(()=>editor.QF.editor.register({onLoad(){}}),/必须提供 getDocument/);
  assert.equal(editor.sent.some(value=>value.kind==='registered'),false);
  editor.receive({kind:'dispose'});
});

test('iframe ignores foreign-source and wrong-session document reads, then preserves callbacks after validation failure',async(t)=>{
  const fixture=iframeFixture({mode:'edit',question:{id:'q1'}});
  t.after(()=>fixture.receive({kind:'dispose'}));
  let invalid=true,reads=0;
  await fixture.QF.editor.register({onLoad(){},hasChanges:()=>true,getDocument(){reads++;if(invalid)throw new Error('请填写题干。');return {title:'题名',data:{stem:'修复后的题干'}};}});
  for(const scope of [{source:{}},{session:'another-session'}])fixture.receive({kind:'read-document',id:'forged-read'},scope);
  await tick();
  assert.equal(reads,0);
  assert.equal(fixture.sent.some(value=>value.kind==='document'),false);

  fixture.receive({kind:'read-document',id:'invalid-read'});
  await tick();
  const invalidReply=fixture.sent.find(value=>value.kind==='document');
  assert.equal(invalidReply.ok,false);
  assert.deepEqual(invalidReply.error,{code:'INVALID_DOCUMENT',message:'请填写题干。'});
  assert.equal(fixture.sent.some(value=>value.kind==='error'),false,'Field validation must not fail iframe registration/lifecycle.');
  invalid=false;
  fixture.receive({kind:'read-document',id:'corrected-read'});
  await tick();
  assert.equal(fixture.sent.find(value=>value.id==='corrected-read').document.data.stem,'修复后的题干');
  assert.equal(reads,2);
});

test('editor input events send dirty changes in scope and stop sending after disposal',async()=>{
  const fixture=iframeFixture({mode:'edit',question:{id:'q1'}});
  let changed=false;
  await fixture.QF.editor.register({onLoad(){},getDocument:()=>({title:'题名',data:{}}),hasChanges:()=>changed});
  fixture.dispatch('input');
  await tick();
  assert.deepEqual(fixture.sent.find(value=>value.kind==='editor-dirty'),{kind:'editor-dirty',changed:false,channel:'quizforge-extension',session:'iframe-session'});
  changed=true;
  fixture.dispatch('change');
  await tick();
  assert.equal(fixture.sent.filter(value=>value.kind==='editor-dirty').at(-1).changed,true);
  fixture.receive({kind:'dispose'});
  const count=fixture.sent.length;
  fixture.dispatch('input');fixture.dispatch('change');fixture.dispatch('click');
  fixture.receive({kind:'read-document',id:'closed-read'});
  await tick();
  assert.equal(fixture.sent.length,count);
});

test('host rejects scoped document and dirty spoofs while accepting matching replies',async(t)=>{
  const fixture=hostFixture({mode:'edit',question:{id:'q1'}});
  t.after(()=>fixture.mounted.destroy());
  fixture.receive({kind:'registered'});await fixture.mounted.ready;
  assert.equal(fixture.mounted.isDirty,false);
  let settled=false;
  const reading=fixture.mounted.getDocument().then(value=>{settled=true;return value;});
  const request=fixture.sent.find(value=>value.kind==='read-document');
  assert.equal(request.checkOnly,false);
  for(const scope of [{source:{}},{session:'another-session'}]){
    fixture.receive({kind:'document',id:request.id,ok:true,document:{title:'forged'},changed:true},scope);
    fixture.receive({kind:'editor-dirty',changed:true},scope);
  }
  await tick();
  assert.equal(settled,false);
  assert.equal(fixture.mounted.isDirty,false);
  fixture.receive({kind:'editor-dirty',changed:true});
  assert.equal(fixture.mounted.isDirty,true);
  fixture.receive({kind:'document',id:request.id,ok:true,document:{title:'真实题名',data:{stem:'题干'}},changed:true});
  assert.deepEqual(structuredClone(await reading),{document:{title:'真实题名',data:{stem:'题干'}},changed:true});
  assert.equal(fixture.timers.size,0);
  fixture.receive({kind:'editor-dirty',changed:false});
  assert.equal(fixture.mounted.isDirty,false);

  const checking=fixture.mounted.getDocument({checkOnly:true});
  const checkRequest=fixture.sent.filter(value=>value.kind==='read-document').at(-1);
  assert.equal(checkRequest.checkOnly,true);
  fixture.receive({kind:'document',id:checkRequest.id,ok:true,changed:false});
  assert.deepEqual(structuredClone(await checking),{document:undefined,changed:false});
});

test('host validation errors leave the editor alive and allow a corrected document retry',async(t)=>{
  const fixture=hostFixture({mode:'edit',question:{id:'q1'}});
  t.after(()=>fixture.mounted.destroy());
  fixture.receive({kind:'registered'});await fixture.mounted.ready;
  const failing=fixture.mounted.getDocument();
  const rejected=assert.rejects(failing,error=>error.message==='请填写选项 A。'&&error.code==='INVALID_DOCUMENT');
  const first=fixture.sent.at(-1);
  fixture.receive({kind:'document',id:first.id,ok:false,error:{code:'INVALID_DOCUMENT',message:'请填写选项 A。'}});
  await rejected;
  assert.equal(fixture.frame.removed,false);
  assert.equal(fixture.timers.size,0);
  const retrying=fixture.mounted.getDocument();
  fixture.receive({kind:'document',id:fixture.sent.at(-1).id,ok:true,document:{title:'有效题名',data:{options:[{id:'A',text:'有效选项'}]}},changed:true});
  assert.equal((await retrying).document.title,'有效题名');
});

test('host dirty checks reconcile input state even when no input event was observed',async(t)=>{
  const fixture=hostFixture({mode:'edit',question:{id:'q1'}});
  t.after(()=>fixture.mounted.destroy());fixture.receive({kind:'registered'});await fixture.mounted.ready;
  const changed=fixture.mounted.getDocument({checkOnly:true});
  fixture.receive({kind:'document',id:fixture.sent.at(-1).id,ok:true,changed:true});await changed;
  assert.equal(fixture.mounted.isDirty,true);
  const clean=fixture.mounted.getDocument({checkOnly:true});
  fixture.receive({kind:'document',id:fixture.sent.at(-1).id,ok:true,changed:false});await clean;
  assert.equal(fixture.mounted.isDirty,false);
});

test('loading a saved editor document clears the old dirty flag while later input can mark it dirty again',async(t)=>{
  const fixture=hostFixture({mode:'edit',question:{id:'q1'}});
  t.after(()=>fixture.mounted.destroy());fixture.receive({kind:'registered'});await fixture.mounted.ready;
  fixture.receive({kind:'editor-dirty',changed:true});assert.equal(fixture.mounted.isDirty,true);
  fixture.mounted.update({mode:'edit',question:{id:'q1',title:'已保存'}});
  assert.equal(fixture.sent.at(-1).kind,'context');assert.equal(fixture.mounted.isDirty,false);
  fixture.receive({kind:'editor-dirty',changed:true});assert.equal(fixture.mounted.isDirty,true);
});

test('destroy rejects outstanding editor reads, releases all timers and never sends a new read',async()=>{
  const fixture=hostFixture({mode:'edit',question:{id:'q1'}});
  fixture.receive({kind:'registered'});await fixture.mounted.ready;
  const reading=fixture.mounted.getDocument();
  const checking=fixture.mounted.getDocument({checkOnly:true});
  const readingRejected=assert.rejects(reading,/编辑页面已关闭/);
  const checkingRejected=assert.rejects(checking,/编辑页面已关闭/);
  assert.equal(fixture.timers.size,2);
  fixture.mounted.destroy();
  await Promise.all([readingRejected,checkingRejected]);
  assert.equal(fixture.timers.size,0);
  assert.equal(fixture.frame.removed,true);
  assert.equal(fixture.sent.at(-1).kind,'dispose');
  const count=fixture.sent.length;
  await assert.rejects(fixture.mounted.getDocument(),/编辑页面已关闭/);
  assert.equal(fixture.sent.length,count);
  fixture.receive({kind:'document',id:'late-read',ok:true,document:{title:'late'}});
  fixture.receive({kind:'editor-dirty',changed:true});
  assert.equal(fixture.mounted.isDirty,false);
});

test('an editor read timeout releases its request and ignores the late reply',async(t)=>{
  const fixture=hostFixture({mode:'edit',question:{id:'q1'}});
  t.after(()=>fixture.mounted.destroy());
  fixture.receive({kind:'registered'});await fixture.mounted.ready;
  const reading=fixture.mounted.getDocument();
  const rejected=assert.rejects(reading,/读取超时，当前修改仍保留/);
  const request=fixture.sent.at(-1);
  const [timerId,timeout]=fixture.timers.entries().next().value;
  fixture.timers.delete(timerId);timeout();
  await rejected;
  fixture.receive({kind:'document',id:request.id,ok:true,document:{title:'stale'}});
  const nextReading=fixture.mounted.getDocument();
  fixture.receive({kind:'document',id:fixture.sent.at(-1).id,ok:true,document:{title:'current'},changed:true});
  assert.equal((await nextReading).document.title,'current');
  assert.equal(fixture.timers.size,0);
});

test('iframe resize shrinks with body content even when the root scrollHeight is fixed by the old viewport',async(t)=>{
  const fixture=iframeFixture();
  t.after(()=>fixture.receive({kind:'dispose'}));
  let bodyHeight=600;
  fixture.document.documentElement.scrollHeight=800;
  fixture.document.body.scrollHeight=600;
  fixture.document.body.getBoundingClientRect=()=>({height:bodyHeight});
  await fixture.QF.page.register({onLoad(){}});
  assert.equal(fixture.sent.filter(value=>value.kind==='resize').at(-1).height,600);

  bodyHeight=350;
  fixture.document.body.scrollHeight=350;
  fixture.QF.ui.resize();
  assert.equal(fixture.sent.filter(value=>value.kind==='resize').at(-1).height,350,'The old iframe height must not become a permanent minimum after retry or shorter content.');
  assert.equal(fixture.document.documentElement.scrollHeight,800);
});


test('development unsaved-input tracking clears only the exact generation acknowledged by a successful real save',async()=>{
  const f=iframeFixture({question:{id:'q'}},{development:true});await f.QF.page.register({onLoad(){}});f.dispatch('input');assert.equal(f.sent.at(-1).kind,'input-dirty');assert.equal(f.sent.at(-1).changed,true);
  const first=f.QF.save({purpose:'draft',data:{answer:'first'}}),request=f.sent.at(-1);f.dispatch('input');f.receive({kind:'reply',id:request.id,reply:{ok:true,data:{}}});await first;assert.equal(f.sent.filter(value=>value.kind==='input-dirty').at(-1).changed,true,'Late acknowledgement cannot discard newer typing.');
  const second=f.QF.save({purpose:'draft',data:{answer:'second'}}),next=f.sent.at(-1);f.receive({kind:'reply',id:next.id,reply:{ok:true,data:{}}});await second;assert.equal(f.sent.filter(value=>value.kind==='input-dirty').at(-1).changed,false);f.receive({kind:'dispose'});
});

test('inactive retained frames release host-request timers and reject further operations until resume',async()=>{
  const f=iframeFixture({question:{id:'q'}},{development:true});await f.QF.page.register({onLoad(){}});const pending=f.QF.save({purpose:'draft',data:{answer:'unfinished'}});assert.equal(f.timers.size,1);
  f.receive({kind:'visibility',active:false});assert.equal((await pending).error.code,'PAGE_INACTIVE');assert.equal(f.timers.size,0);assert.equal((await f.QF.save({purpose:'submit'})).error.code,'PAGE_INACTIVE');
  f.receive({kind:'visibility',active:true});const saving=f.QF.save({purpose:'draft',data:{answer:'resumed'}}),request=f.sent.at(-1);f.receive({kind:'reply',id:request.id,reply:{ok:true,data:{}}});assert.equal((await saving).ok,true);f.receive({kind:'dispose'});assert.equal(f.timers.size,0);
});
