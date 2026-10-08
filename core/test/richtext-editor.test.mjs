import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const light=readFileSync(new URL('../shared/richtext/1.0.0/richtext.js',import.meta.url),'utf8');
const heavy=readFileSync(new URL('../shared/richtext/1.0.0/richtext-editor.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const doc=text=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
const image=id=>({type:'doc',content:[{type:'image',attrs:{assetId:id,alt:'图片'}}]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(t,resources={get:async()=>({url:'blob:local-image',mime:'image/png',size:10}),put:async()=>({id:'a'.repeat(64),mime:'image/png',size:10})}){
  const dom=new JSDOM('<main><div id="first"></div><div id="second"></div></main>',{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});t.after(()=>dom.window.close());dom.window.eval(light);let loaded=0;
  const api=dom.window.QFRichText;api.configure({resources,async loadEditor(){loaded++;dom.window.eval(heavy);}});
  const paste=()=>{const event=new dom.window.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{files:[new dom.window.File(['image bytes'],'demo.png',{type:'image/png'})],getData:()=>''}});dom.window.document.querySelector('.tiptap').dispatchEvent(event);return event;};
  return {dom,api,first:dom.window.document.getElementById('first'),second:dom.window.document.getElementById('second'),loads:()=>loaded,paste};
}
test('static rendering creates safe text and resolves images without loading the editor',async t=>{
  const pending=deferred(),f=fixture(t,{get:()=>pending.promise}),value={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'<script>unsafe()</script>',marks:[{type:'bold'}]}]},image('b'.repeat(64)).content[0]]};
  const view=f.api.render(f.first,value);assert.equal(f.first.querySelector('script'),null);assert.equal(f.first.querySelector('strong').textContent,'<script>unsafe()</script>');assert.equal(f.loads(),0);const oldImage=f.first.querySelector('img');
  view.destroy();pending.resolve({url:'blob:late',mime:'image/png',size:10});await view.ready;assert.equal(oldImage.hasAttribute('src'),false);assert.equal(f.first.children.length,0);
});
test('actual Tiptap editor round-trips formatting and asset IDs; only one instance exists',async t=>{
  const f=fixture(t),value={type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'标题',marks:[{type:'bold'}]}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'内容'}]}]}]},image('c'.repeat(64)).content[0]]};
  const editor=f.api.createEditor(f.first,{doc:value});assert.throws(()=>f.api.createEditor(f.second,{doc:doc('其他')}),/结束当前/);await editor.ready;await editor.flush();
  assert.equal(f.loads(),1);assert.deepEqual(plain(editor.getDocument()),value);assert.equal(f.first.querySelectorAll('.tiptap').length,1);assert.equal(JSON.stringify(editor.getDocument()).includes('src'),false);
  editor.setDocument(doc('替换后的内容'));assert.deepEqual(plain(editor.getDocument()),doc('替换后的内容'));editor.destroy();assert.equal(f.first.children.length,0);
  const next=f.api.createEditor(f.second,{doc:doc('下个字段')});await next.ready;assert.equal(f.loads(),1);next.destroy();
});
test('flush waits for a pasted image and persistence contains no runtime URL',async t=>{
  const pending=deferred(),f=fixture(t,{get:async()=>({url:'blob:asset',mime:'image/png',size:8}),put:()=>pending.promise}),changes=[];
  const editor=f.api.createEditor(f.first,{doc:doc('答案'),onChange:value=>changes.push(plain(value))});await editor.ready;assert.equal(f.paste().defaultPrevented,true);assert.equal(editor.isUploading(),true);
  let flushed=false;const flush=editor.flush().then(()=>{flushed=true;});await tick();assert.equal(flushed,false);pending.resolve({id:'d'.repeat(64),mime:'image/png',size:8});await flush;
  assert.equal(editor.isUploading(),false);assert.equal(JSON.stringify(editor.getDocument()).includes('blob:'),false);assert.equal(editor.getDocument().content.some(node=>node.type==='image'&&node.attrs.assetId==='d'.repeat(64)),true);assert.ok(changes.length>0);editor.destroy();
});
test('late upload after a document replacement cannot insert into the new document',async t=>{
  const pending=deferred(),f=fixture(t,{get:async()=>({url:'blob:asset'}),put:()=>pending.promise}),editor=f.api.createEditor(f.first,{doc:doc('旧答案')});await editor.ready;f.paste();editor.setDocument(doc('新答案'));
  pending.resolve({id:'e'.repeat(64),mime:'image/png',size:8});await editor.flush();assert.deepEqual(plain(editor.getDocument()),doc('新答案'));editor.destroy();
});
test('upload errors block flush and late work after destroy cannot affect the next editor',async t=>{
  const pending=deferred(),f=fixture(t,{get:async()=>({url:'blob:asset'}),put:()=>pending.promise}),editor=f.api.createEditor(f.first,{doc:doc('旧答案')});await editor.ready;f.paste();pending.reject(new Error('写入失败'));await assert.rejects(editor.flush(),/写入失败/);assert.deepEqual(plain(editor.getDocument()),doc('旧答案'));editor.destroy();
  const next=f.api.createEditor(f.second,{doc:doc('保留正文')});await next.ready;await next.flush();assert.deepEqual(plain(next.getDocument()),doc('保留正文'));next.destroy();
});
test('destroying during lazy loading cancels mounting the obsolete editor',async t=>{
  const f=fixture(t),pending=deferred();f.api.configure({loadEditor:async()=>{await pending.promise;f.dom.window.eval(heavy);}});
  const old=f.api.createEditor(f.first,{doc:doc('过时')});old.destroy();const next=f.api.createEditor(f.second,{doc:doc('当前')});pending.resolve();await Promise.all([old.ready,next.ready]);
  assert.equal(f.first.children.length,0);assert.deepEqual(plain(next.getDocument()),doc('当前'));next.destroy();
});
