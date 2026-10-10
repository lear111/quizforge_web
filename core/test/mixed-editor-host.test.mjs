import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {createEditorSession} from '../web/editor-session.js';
import {collectionFeature,canEditCollection} from '../web/practice-context.js';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const editorSource=source.slice(source.indexOf('async function showEditorQuestion('),source.indexOf('\nasync function openEditor('));

test('bank editors switch independent grouped extensions and restore their own durable unfinished drafts',async t=>{
  const dom=new JSDOM('<body></body>');t.after(()=>dom.window.close());const document=dom.window.document,node=document.createElement('section'),frameHost=document.createElement('div');node.append(frameHost);document.body.append(node);
  const choice={id:'choice',version:'1.0.0',group:'语言题型'},essay={id:'essay',version:'1.0.0',group:'语言题型'},types={a:choice,b:essay},drafts=new Map(),mounted=[];let live=0,maxLive=0;
  const pane={id:'mixed',kind:'bank',closed:false,node,frameHost,questionId:'a',view:'practice',plugin:null,viewport:{scrollTop:0,scrollLeft:0},tools:{},whiteboard:{setMode(){}},collection:{questions:[{id:'a',type:choice},{id:'b',type:essay}],states:{}}};
  const sandbox={document,collectionFeature,canEditCollection,request:async path=>{
    const id=path.split('/').at(-1)==='editor'?path.split('/').at(-2):path.split('/').at(-1);
    return path.endsWith('/editor')?{extension:types[id],question:{id,data:{}},editor:{html:`${types[id].id}-editor`},contentVersion:`content-${id}`,revision:0}:{contentVersion:`content-${id}`,changed:true,draft:drafts.get(id)||null};
  },questionPath:(_kind,_id,qid)=>`/questions/${qid}`,editorDraftPath:(_pane,qid)=>`/drafts/${qid}`,prepareAssets:async value=>value,active:()=>pane,notice(){},pageRequest(){},scheduleEditorDraft(){},setEditorLayout(){},syncPracticeCamera(){},renderOutline(){},updateChrome(){},saveStatus(){},el:(tag,classes)=>{const child=document.createElement(tag);child.className=classes;return child;},newEditorSession:()=>createEditorSession({persistDraft:(id,_entry,snapshot)=>{drafts.set(id,snapshot.draft);}}),mountExtension:(container,assets,context,options)=>{
    const frame=document.createElement('iframe');container.append(frame);live++;maxLive=Math.max(maxLive,live);let destroyed=false;const draft=options.editorDraft||{extensionId:types[context.question.id].id,text:''};
    mounted.push({assets,context,draft});return {frame,ready:Promise.resolve(),flush:async()=>{},exportDraft:async()=>({supported:true,changed:true,draft}),destroy(){if(destroyed)return;destroyed=true;live--;frame.remove();}};
  }};
  vm.runInNewContext(editorSource+'\nglobalThis.show=showEditorQuestion;',sandbox);
  await sandbox.show(pane,'a');mounted[0].draft.text='unfinished choice';await sandbox.show(pane,'b');mounted[1].draft.text='unfinished essay';await sandbox.show(pane,'a');
  assert.deepEqual(mounted.map(row=>row.assets.html),['choice-editor','essay-editor','choice-editor']);assert.equal(mounted.at(-1).draft.text,'unfinished choice');assert.equal(drafts.get('b').text,'unfinished essay');assert.equal(pane.editState.extension.id,'choice');assert.equal(maxLive,1);assert.equal(live,1);assert.equal(frameHost.children.length,1);
  pane.editorSession.destroy();assert.equal(live,0);
});
