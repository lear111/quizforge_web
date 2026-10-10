import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const coreRoot=new URL('../',import.meta.url),root=new URL('../../',import.meta.url),read=path=>readFileSync(new URL(path,path.startsWith('shared/')?coreRoot:root),'utf8');
const sample=JSON.parse(read('core/test/fixtures/legacy-extensions/short-answer/examples.json')).questions[0];
const plain=value=>JSON.parse(JSON.stringify(value)),paragraph=text=>({type:'doc',content:[{type:'paragraph',...(text?{content:[{type:'text',text}]}:{})}]});
async function fixture(t){
  const dom=new JSDOM(read('core/test/fixtures/legacy-extensions/short-answer/editor.html'),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});t.after(()=>dom.window.close());dom.window.eval(read('shared/richtext/1.0.0/richtext.js'));const api=dom.window.QFRichText;
  api.configure({resources:{get:async()=>({url:'blob:local',mime:'image/png',size:10}),put:async()=>({id:'a'.repeat(64),mime:'image/png',size:10})},async loadEditor(){dom.window.eval(read('shared/richtext/1.0.0/richtext-editor.js'));}});
  let hooks;dom.window.QF={content:api,editor:{register:value=>{hooks=value;}},ui:{resize(){}}};dom.window.eval(read('core/test/fixtures/legacy-extensions/short-answer/editor.js'));await hooks.onLoad({mode:'edit',question:plain(sample),capabilities:{canEdit:true}});
  return {dom,api,hooks,byId:id=>dom.window.document.getElementById(id)};
}
test('short-answer editor keeps three fields static until activated and returns a clean document',async t=>{
  const f=await fixture(t);assert.equal(f.dom.window.document.querySelector('.tiptap'),null);assert.equal(f.hooks.hasChanges(),false);
  assert.deepEqual(plain(await f.hooks.getDocument()),{title:sample.title,data:sample.data});
  f.byId('activate-stem').click();await f.hooks.onFlush();assert.equal(f.dom.window.document.querySelectorAll('.tiptap').length,1);
  f.byId('activate-referenceAnswer').click();await f.hooks.onFlush();assert.equal(f.dom.window.document.querySelectorAll('.tiptap').length,1);assert.equal(f.byId('edit-stem').classList.contains('is-active'),false);assert.equal(f.byId('edit-referenceAnswer').classList.contains('is-active'),true);
  assert.equal(f.hooks.hasChanges(),false);f.hooks.onDispose();assert.equal(f.dom.window.document.querySelector('.tiptap'),null);
});
test('unfinished rich-text draft exports, restores and remains dirty without requiring valid fields',async t=>{
  const f=await fixture(t),draft={formatVersion:1,title:'',scoreText:'',documents:{stem:paragraph('未完成题干'),referenceAnswer:paragraph(''),rubric:paragraph('')}};
  await f.hooks.importDraft(draft);assert.deepEqual(plain(await f.hooks.exportDraft()),draft);assert.equal(f.hooks.hasChanges(),true);await assert.rejects(f.hooks.getDocument(),/题名/);
  f.byId('edit-title').value='新题名';f.byId('edit-score').value='2.75';await assert.rejects(f.hooks.getDocument(),/参考答案/);
  const ready=plain(await f.hooks.exportDraft());ready.documents.referenceAnswer=paragraph('参考');ready.documents.rubric=paragraph('说明');await f.hooks.importDraft(ready);await assert.rejects(f.hooks.getDocument(),/0.5/);
  f.byId('edit-score').value='2.5';const value=plain(await f.hooks.getDocument());assert.equal(value.data.maxScore,2.5);assert.equal(value.title,'新题名');assert.equal(value.data.stem.content[0].content[0].text,'未完成题干');f.hooks.onDispose();
});
test('disposing before an asynchronous activation finishes cannot mount an obsolete editor',async t=>{
  const f=await fixture(t);let release;const pending=new Promise(resolve=>{release=resolve;});f.api.configure({loadEditor:async()=>{await pending;f.dom.window.eval(read('shared/richtext/1.0.0/richtext-editor.js'));}});
  f.byId('activate-rubric').click();await Promise.resolve();f.hooks.onDispose();release();await f.hooks.onFlush();assert.equal(f.dom.window.document.querySelector('.tiptap'),null);
});
