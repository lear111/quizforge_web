import {loadPracticeLifecycle} from '../fixtures/practice-lifecycle.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createEditorSession} from '../../web/editor/editor-session.js';
import {canEditCollection} from '../../web/practice/practice-context.js';

const source=readFileSync(new URL('../../web/app.js',import.meta.url),'utf8');
const saveSource=source.slice(source.indexOf('async function saveEditor('),source.indexOf('\nconst developmentPath='));
function fixture(t,{fail=false,invalid=false}={}){
  const session=createEditorSession(),calls=[],form={changed:true},plugin={get isDirty(){return form.changed;},async flush(){calls.push('flush');},async getDocument({checkOnly=false}={}){if(!checkOnly&&invalid)throw new Error('invalid content');return {changed:form.changed,document:{title:'new title',data:{stem:'new stem'}}};},update(){form.changed=false;},destroy(){calls.push('destroy');}};
  const pane={key:'bank:a',kind:'bank',id:'a',view:'edit',questionId:'q1',node:{},plugin,editorSession:session,collection:{features:{editing:true}}};session.add('q1',{value:{sourceVersion:'source',revision:2,contentVersion:'content'},plugin});
  const sandbox={canEditCollection,practiceLifecycle:loadPracticeLifecycle(t),TypeError,updateChrome(){},saveStatus:message=>calls.push(message),makeRequestId:()=> 'request1',questionPath:()=>'/question',questionCacheKey:()=> 'cache',questionsCache:{deleteCollection(){},set(){}},collectionPath:()=>'/collection',loadQuestion:async()=>({}),refreshCatalog:async()=>{},showQuestion:async target=>{calls.push('practice');target.editorSession.destroy();target.editorSession=null;target.view='practice';},notice:message=>calls.push(message),request:async(url,options)=>{calls.push({url,method:options?.method});if(url.endsWith('/edit')){if(fail)throw new Error('network failed');return {collection:pane.collection,payload:{state:{revision:3},stamp:{contentVersion:'next'}},sourceVersion:'next'};}return pane.collection;}};
  vm.runInNewContext(saveSource+'\nglobalThis.save=saveEditor;',sandbox);return {pane,calls,form,save:()=>sandbox.save(pane),sandbox};
}
test('explicit saving commits only the current question and exits editing after success',async t=>{
  const f=fixture(t);await f.save();assert.deepEqual(f.calls.filter(row=>row?.method),[{url:'/question/edit',method:'POST'}]);assert.equal(f.pane.view,'practice');assert.equal(f.sandbox.practiceLifecycle.pendingWrites,0);assert.equal(f.form.changed,false);assert.equal(f.calls.at(-1),'本题修改已保存。');
});
for(const options of [{fail:true},{invalid:true}])test('failed current-question save preserves the form and does not open practice: '+JSON.stringify(options),async t=>{
  const f=fixture(t,options),session=f.pane.editorSession;await assert.rejects(f.save(),/network failed|invalid content/);assert.equal(f.pane.view,'edit');assert.equal(f.pane.editorSession,session);assert.equal(f.form.changed,true);assert.equal(f.sandbox.practiceLifecycle.pendingWrites,0);assert.equal(f.calls.includes('practice'),false);
});
