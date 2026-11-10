import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {createWriteQueue} from '../../web/shared/write-queue.js';
import {previewDraftAnswer,confirmAnswerPreview,reportAnswerPreview,answerStateForSave} from '../../web/practice/answer-preview.js';
import {renderOutlineView} from '../../web/outline/outline-view.js';
import {stateFor,collectionFeature,practiceSaveLabel} from '../../web/practice/practice-context.js';
const source=fs.readFileSync(new URL('../../web/app.js',import.meta.url),'utf8');
const mutate=source.slice(source.indexOf('async function mutate('),source.indexOf('\nfunction renderRecovery('));
function fixture(t){
 const dom=new JSDOM('<div id="outline-list"></div>',{runScripts:'outside-only'});loadVueUi(dom);t.after(()=>dom.window.close());
 const pane={view:'practice',questionId:'q',renderedContentVersion:'version',collection:{questions:[{id:'q',title:'question'}],states:{q:{status:'unanswered',revision:0,answer:null,result:null}}}};
 const labels=[],requests=[];let release,reject;
 pane.writes=createWriteQueue({makeRequestId:()=> 'save',revisionFor:qid=>stateFor(pane,qid).revision,send:(_qid,request)=>{requests.push(request);return new Promise((ok,no)=>{release=ok;reject=no;});},onSaved:(qid,_action,value)=>{pane.collection.states[qid]=value.state;}});
 const renderOutline=()=>renderOutlineView({document:dom.window.document,pane,onNavigate(){},onSummary(){}});
 const sandbox={previewDraftAnswer,confirmAnswerPreview,answerStateForSave,active:()=>pane,renderOutline,collectionFeature,practiceSaveLabel,saveStatus:label=>labels.push(label)};
 vm.runInNewContext(mutate+'\nglobalThis.save=mutate;',sandbox);
 return {pane,dom,labels,requests,save:sandbox.save,resolve:value=>release(value),reject:error=>reject(error)};
}
test('real host mutation updates outline before the network reply while confirmed state stays unchanged',async t=>{
 const f=fixture(t),saving=f.save(f.pane,'draft',{answer:'new answer'});
 assert.equal(f.dom.window.document.querySelector('.outline-item').classList.contains('draft'),true);
 assert.deepEqual(f.pane.collection.states.q,{status:'unanswered',revision:0,answer:null,result:null});assert.equal(f.labels.at(-1),'保存中…');
 await new Promise(resolve=>setImmediate(resolve));f.resolve({state:{status:'draft',revision:1,answer:'new answer',result:null}});await saving;
 assert.equal(f.pane.answerPreviews.size,0);assert.equal(f.labels.at(-1),'已保存');assert.equal(f.pane.collection.states.q.revision,1);
});
test('failed persistence retains filled feedback and never changes confirmed answer or revision',async t=>{
 const f=fixture(t),saving=f.save(f.pane,'draft',{answer:'local'});
 await new Promise(resolve=>setImmediate(resolve));f.reject(new Error('disk unavailable'));await assert.rejects(saving,/disk unavailable/);
 assert.equal(f.pane.writes.hasFailures,true);assert.equal(f.pane.collection.states.q.revision,0);assert.equal(f.pane.collection.states.q.answer,null);assert.equal(f.dom.window.document.querySelector('.outline-item').classList.contains('draft'),true);
});
test('child report renders immediately and an older saved snapshot cannot clear a newer report',async t=>{
 const f=fixture(t);f.pane.collection.questions[0].outlineItems=[{id:'a',label:'1'},{id:'b',label:'2'}];
 const first=reportAnswerPreview(f.pane,{targetId:'a',status:'draft'});
 const saving=f.save(f.pane,'draft',{answer:'old'},{answerStateId:first.stateId});
 assert.equal(f.dom.window.document.querySelector('[data-outline-item-id="a"]').classList.contains('draft'),true);
 const newer=reportAnswerPreview(f.pane,{targetId:'b',status:'draft'});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.requests[0].data.answerState,{status:'draft',outlineStates:[{id:'a',status:'draft'}]});f.resolve({state:{status:'draft',revision:1,answer:'old',result:null,outlineStates:first.outlineStates,answerState:f.requests[0].data.answerState}});await saving;
 assert.equal(f.pane.answerPreviews.get('q'),newer);assert.equal(f.dom.window.document.querySelector('[data-outline-item-id="b"]').classList.contains('draft'),true);assert.equal(f.labels.at(-1),'答案尚未保存');
});
