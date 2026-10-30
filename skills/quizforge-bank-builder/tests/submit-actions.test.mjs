import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../../../',import.meta.url)),require=createRequire(path.join(root,'core/package.json')),{JSDOM}=require('jsdom');
const leaves=fs.readdirSync(path.join(root,'extensions'),{withFileTypes:true}).filter(e=>e.isDirectory()).flatMap(g=>fs.readdirSync(path.join(root,'extensions',g.name),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>path.join(root,'extensions',g.name,e.name))).filter(p=>fs.existsSync(path.join(p,'practice.js')));
const clone=v=>JSON.parse(JSON.stringify(v)),tick=()=>new Promise(r=>setTimeout(r,0)),defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const doc=text=>({type:'doc',content:[{type:'paragraph',content:text?[{type:'text',text}]:[]}]}),nonempty=v=>JSON.stringify(v||'').includes('text')&&JSON.stringify(v).includes('text":"')&&!JSON.stringify(v).includes('text":""');
function fixture(t,leaf){
 const manifest=JSON.parse(fs.readFileSync(path.join(leaf,'manifest.json'))),sample=JSON.parse(fs.readFileSync(path.join(leaf,manifest.examples))).questions[0],source=fs.readFileSync(path.join(leaf,'practice.js'),'utf8');new vm.Script(source);
 const dom=new JSDOM(fs.readFileSync(path.join(leaf,manifest.entry),'utf8'),{runScripts:'outside-only',url:'http://localhost/'}),w=dom.window;w.structuredClone=clone;let hooks,stateId=0,gate=null,fail=false,actionGate=null;const calls=[];
 const ctx={mode:'practice',status:'unanswered',question:clone(sample),capabilities:{canSave:true,canSubmit:true,canRetry:false,canReview:false,canAiGrade:false},answer:null,result:null};
 const saver=source.includes('function createAnswerSaver'),choice=saver&&source.includes('const KIND ='),area=saver&&source.includes('const components ='),store=source.includes('function createPersistence'),standalone=!saver&&!store;
 w.QF={content:{isEmpty:v=>!nonempty(v),render:()=>({ready:Promise.resolve(),destroy(){}})},ui:{resize(){}},page:{register(h){hooks=h;return Promise.resolve();},reportAnswerState:async()=>({ok:true,data:{stateId:String(++stateId)}})},save:async x=>{calls.push(clone(x));if(x.purpose==='draft'){if(gate)await gate.promise;if(fail)return {ok:false,error:{code:'DISK',message:'磁盘写入失败'}};}return {ok:true,data:{}};},requestAction:async x=>{calls.push(clone(x));if(actionGate)await actionGate.promise;return {ok:true,data:{}};}};
 const set=saver?choice?`selected=new Set(value?[KIND==='true-false'?'true':context.question.data.options[0].id]:[]);saver.changed();controls();`:`const id=context.question.data.parts[0].id;const valueDoc=${area?`{type:'qf-answer-area',formatVersion:1,id:'response-'+id,width:760,height:480,strokes:[],text:value}`:'globalThis.__doc(value)'};changedAnswer(id,valueDoc)?.catch?.(()=>{});`:store?`answer=value?{[data.parts[0].id]:${source.includes('some(areaNonempty)')?`{type:'qf-answer-area',formatVersion:1,id:'response',width:760,height:480,strokes:[],text:value}`:'value'}}:{};store.changed(data.parts[0].id);store.enter(context);`:`changed(${source.includes('areaEmpty(answer)')?`{type:'qf-answer-area',formatVersion:1,id:'response',width:760,height:480,strokes:[],text:value}`:'globalThis.__doc(value)'});controls();`;
 const inject=`
 globalThis.__actions={
 init(next){context=next;${store?'data=next.question.data;store.enter(next);':saver?'controls();':'controls();'}},
 set(value){${set}},
 submit:()=>${store?'store.submit()':'submit()'},
 retry:()=>${store?'store.retry()':standalone?`(document.getElementById('retry-button').click(),Promise.resolve())`:'retry()'},
 flush:()=>${store?'store.flush()':choice?'saver.flush()':'flush()'},
 component(promise){${area?`components.set(context.question.data.parts[0].id,{flush:()=>promise,destroy(){}});`:(standalone&&source.includes('area=null'))?'area={flush:()=>promise,destroy(){}};':store&&/\bcomponents\s*=\s*new Map/.test(source)?`components.set(data.parts[0].id,{flush:()=>promise,destroy(){}});`:''}},
 };
 `;
 w.__doc=doc;const last=source.lastIndexOf('})();');assert(last>0,leaf);w.eval(source.slice(0,last)+inject+source.slice(last));w.__actions.init(ctx);
 const f={w,calls,ctx,api:w.__actions,button:w.document.getElementById(saver?'submit':'submit-button'),retry:w.document.getElementById(saver?'retry':'retry-button'),setGate:g=>gate=g,setFail:v=>fail=v,setActionGate:g=>actionGate=g,hasComponent:area||(standalone&&source.includes('area=null'))||(store&&/\bcomponents\s*=\s*new Map/.test(source))};
 t.after(()=>{hooks?.onDispose();w.close();});return f;
}
for(const leaf of leaves){const name=path.relative(path.join(root,'extensions'),leaf);
 test(`${name}: background saving stays clickable; submit waits, captures latest answer and ignores duplicate clicks`,async t=>{
  const f=fixture(t,leaf);assert(f.button.disabled);f.api.set('first');const gate=defer();f.setGate(gate);const saving=f.api.flush();saving.catch(()=>{});await tick();assert.equal(f.button.disabled,false);f.api.set('latest');
  const a=f.api.submit(),b=f.api.submit();await tick();assert(f.button.disabled);assert.match(f.button.textContent,/提交中/);assert.equal(f.calls.filter(c=>c.purpose==='submit').length,0);gate.resolve();await Promise.all([saving,a,b]);await tick();
  const submitted=f.calls.filter(c=>c.purpose==='submit');assert.equal(submitted.length,1);const answer=submitted[0].data.answer;if(!name.includes('单选')&&!name.includes('多选')&&!name.includes('判断'))assert.match(JSON.stringify(answer),/latest/);assert.equal(f.button.disabled,false);
 });
 test(`${name}: failed save blocks submit and restores button; submitted/read-only stale draft does not block retry`,async t=>{
  const f=fixture(t,leaf);f.api.set('unsaved');f.setFail(true);await f.api.submit().catch(()=>{});assert.equal(f.calls.filter(c=>c.purpose==='submit').length,0);assert.equal(f.button.disabled,false);assert.match(f.w.document.body.textContent,/磁盘写入失败/);
  f.ctx.status='submitted';f.ctx.capabilities.canSave=false;f.ctx.capabilities.canSubmit=false;f.ctx.capabilities.canRetry=true;f.api.init(f.ctx);await f.api.flush();const gate=defer();f.setActionGate(gate);await tick();const a=f.api.retry(),b=f.api.retry();await tick();gate.resolve();await Promise.all([a,b]);await tick();assert.equal(f.calls.filter(c=>c.action==='retry').length,1);
 });
 test(`${name}: flushes answer-area component before submit when present`,async t=>{
  const f=fixture(t,leaf);if(!f.hasComponent){t.skip('This type has no answer-area component');return;}f.api.set('before');const gate=defer();f.api.component(gate.promise);const job=f.api.submit();await tick();assert.equal(f.calls.filter(c=>c.purpose==='submit').length,0);f.api.set('component latest');gate.resolve();await job;assert.equal(f.calls.filter(c=>c.purpose==='submit').length,1);assert.match(JSON.stringify(f.calls.find(c=>c.purpose==='submit').data.answer),/component latest/);
 });
 test(`${name}: losing save permission before submission discards stale draft without replay`,async t=>{
  const f=fixture(t,leaf);f.api.set('unsaved');f.setFail(true);await f.api.flush().catch(()=>{});const count=f.calls.length;f.ctx.capabilities.canSave=false;await f.api.flush();assert.equal(f.calls.length,count);
 });
}
