import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {validateDocument,fromEditorDocument} from '../shared/richtext/1.1.1/src/document.js';
const read=file=>readFileSync(new URL(`../shared/richtext/1.1.1/${file}`,import.meta.url),'utf8');
const light=read('richtext.js'),heavy=read('richtext-editor.js'),css=read('richtext.css');
const plain=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]}),doc=text=>({type:'doc',content:[paragraph(text)]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(t,{setExpanded,put=async()=>({id:'a'.repeat(64)})}={}){
  const dom=new JSDOM('<!doctype html><main><div id="field"></div><div id="view"></div></main>',{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});t.after(()=>dom.window.close());
  dom.window.Range.prototype.getClientRects=()=>[];
  dom.window.Range.prototype.getBoundingClientRect=()=>({top:0,bottom:0,left:0,right:0,width:0,height:0});
  const style=dom.window.document.createElement('style');style.textContent=css;dom.window.document.head.append(style);dom.window.eval(light);const api=dom.window.QFRichText;let loaded=0;
  api.configure({resources:{get:async()=>({url:'blob:local'}),put},setExpanded,async loadEditor(){loaded++;dom.window.eval(heavy);}});
  const field=dom.window.document.getElementById('field'),view=dom.window.document.getElementById('view');
  const paste=()=>{const event=new dom.window.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{files:[new dom.window.File(['image'],'image.png',{type:'image/png'})],getData:()=>''}});field.querySelector('.tiptap').dispatchEvent(event);};
  return {dom,api,field,view,paste,loads:()=>loaded};
}
const rich={type:'doc',content:[{type:'heading',attrs:{level:2,textAlign:'center',lineHeight:'1.5'},content:[{type:'text',text:'题干',marks:[{type:'textStyle',attrs:{color:'#123456',fontFamily:'Microsoft YaHei',fontSize:'24px'}},{type:'highlight',attrs:{color:'#fff3a3'}}]}]},{type:'paragraph',content:[{type:'text',text:'x',marks:[{type:'superscript'}]},{type:'inlineMath',attrs:{latex:'E=mc^2'}}]},{type:'blockMath',attrs:{latex:'\\frac{a}{b}'}},{type:'table',content:[{type:'tableRow',content:[{type:'tableHeader',attrs:{colspan:2,colwidth:[120,120]},content:[paragraph('表头')]}]},{type:'tableRow',content:[{type:'tableCell',content:[paragraph('A')]},{type:'tableCell',content:[paragraph('B')]}]}]},{type:'image',attrs:{assetId:'b'.repeat(64),width:320,align:'right',alt:'示意图'}}]};
test('new document schema accepts legacy content and rejects unsafe style/resource attributes',()=>{
  assert.equal(validateDocument(doc('旧内容')),true);assert.equal(validateDocument(rich),true);
  for(const value of [{type:'doc',content:[{type:'paragraph',attrs:{textAlign:'expression(alert(1))'}}]},{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'bad',marks:[{type:'textStyle',attrs:{color:'url(https://x)'}}]}]}]},{type:'doc',content:[{type:'image',attrs:{assetId:'a'.repeat(64),src:'https://x'}}]},{type:'doc',content:[{type:'blockMath',attrs:{latex:'x',trust:true}}]}])assert.equal(validateDocument(value),false);
  assert.deepEqual(fromEditorDocument({type:'doc',content:[{type:'paragraph',attrs:{textAlign:null,lineHeight:null},content:[{type:'text',text:'粘贴',marks:[{type:'textStyle',attrs:{color:'rgb(18, 52, 86)',fontFamily:'"Georgia"',fontSize:'12px',evil:'ignored'}}]}]}]}),{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'粘贴',marks:[{type:'textStyle',attrs:{color:'#123456',fontFamily:'Georgia',fontSize:'12px'}}]}]}]});
});
test('readonly renderer handles table, styles, math and sized images without creating editors',async t=>{
  const f=fixture(t);assert.equal(f.api.version,'1.1.1');const rendered=f.api.render(f.view,rich);await rendered.ready;assert.equal(f.loads(),0);assert.equal(f.view.querySelectorAll('math').length,2);assert.equal(f.view.querySelector('h2').style.textAlign,'center');assert.equal(f.view.querySelector('h2').style.lineHeight,'1.5');assert.equal(f.view.querySelector('span[style]').style.fontSize,'24px');assert.equal(f.view.querySelector('th').colSpan,2);assert.equal(f.view.querySelector('img').style.width,'320px');assert.equal(f.view.querySelector('img').style.marginRight,'0px');assert.equal(f.view.querySelector('iframe'),null);rendered.destroy();
});
test('actual editor preserves all versioned nodes and attributes through save and advanced toggle',async t=>{
  const calls=[],f=fixture(t,{setExpanded:async value=>calls.push(plain(value))}),editor=f.api.createEditor(f.field,{doc:rich});await editor.ready;await editor.flush();assert.deepEqual(plain(editor.getDocument()),rich);
  const editable=f.field.querySelector('.tiptap'),inlineWidth=645.333374;editable.getBoundingClientRect=()=>({width:inlineWidth});await editor.setAdvanced(true);assert.equal(editor.isAdvanced(),true);assert.equal(f.field.querySelector('.tiptap'),editable);assert.equal(parseFloat(editable.style.width),inlineWidth);assert.deepEqual(calls[0],{expanded:true,contentWidth:inlineWidth-32});assert.equal(f.field.querySelector('.qfrt-ribbon').hidden,false);
  await editor.setAdvanced(false);assert.equal(f.field.querySelector('.tiptap'),editable);assert.equal(editable.style.width,'');assert.deepEqual(plain(editor.getDocument()),rich);assert.equal(calls.length,2);editor.destroy();
});
test('leaving advanced editing waits for uploads and keeps resulting document in the same instance',async t=>{
  const pending=deferred(),calls=[],f=fixture(t,{put:()=>pending.promise,setExpanded:async value=>calls.push(plain(value))}),editor=f.api.createEditor(f.field,{doc:doc('答案'),contentWidth:500});await editor.ready;await editor.setAdvanced(true);f.paste();let closed=false;const closing=editor.setAdvanced(false).then(()=>{closed=true;});await tick();assert.equal(closed,false);assert.equal(calls.length,1);pending.resolve({id:'c'.repeat(64)});await closing;assert.equal(calls[1].expanded,false);assert.equal(editor.getDocument().content.some(value=>value.type==='image'&&value.attrs.assetId==='c'.repeat(64)),true);editor.destroy();
});
test('host expansion rejection leaves the basic editor and saved data intact',async t=>{
  const f=fixture(t,{setExpanded:async()=>{throw new Error('宿主窗口不可用');}}),editor=f.api.createEditor(f.field,{doc:doc('保留')});await editor.ready;await assert.rejects(editor.setAdvanced(true),/宿主窗口/);assert.equal(editor.isAdvanced(),false);assert.equal(f.field.querySelector('.qfrt-ribbon').hidden,true);assert.deepEqual(plain(editor.getDocument()),doc('保留'));editor.destroy();
});
test('destroying advanced editor informs host and lazy editor library still loads once',async t=>{
  const calls=[],f=fixture(t,{setExpanded:async value=>calls.push(plain(value))}),editor=f.api.createEditor(f.field,{doc:doc('结束')});await editor.ready;await editor.setAdvanced(true);editor.destroy();await tick();assert.equal(calls.at(-1).expanded,false);const next=f.api.createEditor(f.field,{doc:doc('下一字段')});await next.ready;assert.equal(f.loads(),1);next.destroy();
});
test('formula rendering keeps untrusted LaTeX from introducing clickable or external content',async t=>{
  const f=fixture(t),view=f.api.render(f.view,{type:'doc',content:[{type:'blockMath',attrs:{latex:'\\href{javascript:alert(1)}{bad}'}},{type:'blockMath',attrs:{latex:'\\includegraphics{https://example.com/remote.png}'}}]});await view.ready;assert.equal(f.view.querySelector('a,img,script,iframe'),null);view.destroy();
});
test('advanced formatting controls produce portable, validated document attributes',async t=>{
  const f=fixture(t),editor=f.api.createEditor(f.field,{doc:doc('统一排版')});await editor.ready;await editor.setAdvanced(true);
  f.field.querySelector('button[aria-label="全选"]').click();
  const size=f.field.querySelector('select[aria-label="字号"]');size.value='24px';size.dispatchEvent(new f.dom.window.Event('change'));
  const tint=f.field.querySelector('input[aria-label="文字颜色"]');tint.value='#123456';tint.dispatchEvent(new f.dom.window.Event('input'));
  f.field.querySelector('button[aria-label="粗体"]').click();
  const line=f.field.querySelector('select[aria-label="行距"]');line.value='2';line.dispatchEvent(new f.dom.window.Event('change'));
  await editor.flush();const value=plain(editor.getDocument());assert.equal(validateDocument(value),true);assert.equal(value.content[0].attrs.lineHeight,'2');const style=value.content[0].content[0].marks.find(mark=>mark.type==='textStyle');assert.equal(style.attrs.fontSize,'24px');assert.equal(style.attrs.color,'#123456');assert.ok(value.content[0].content[0].marks.some(mark=>mark.type==='bold'));editor.destroy();
});
test('default text color inherits practice colors and clearing a custom color restores inheritance',async t=>{
  const f=fixture(t);f.dom.window.document.querySelector('main').style.color='rgb(48, 45, 65)';const view=f.api.render(f.view,doc('同色正文')),editor=f.api.createEditor(f.field,{doc:doc('同色正文')});await editor.ready;await view.ready;
  const color=f.dom.window.getComputedStyle(f.field.querySelector('.qfrt-editor')).color;assert.equal(color,f.dom.window.getComputedStyle(f.view.querySelector('.qfrt-document')).color);assert.equal(color,'rgb(48, 45, 65)');assert.equal(f.field.querySelector('input[aria-label="文字颜色"]').value,'#302d41');
  await editor.setAdvanced(true);f.field.querySelector('button[aria-label="全选"]').click();const picker=f.field.querySelector('input[aria-label="文字颜色"]');picker.value='#123456';picker.dispatchEvent(new f.dom.window.Event('input'));f.field.querySelector('button[aria-label="恢复文字颜色"]').click();await editor.flush();assert.deepEqual(plain(editor.getDocument()),doc('同色正文'));assert.equal(picker.value,'#302d41');editor.destroy();view.destroy();
});
test('dialog confirmation uses button clicks without native form submission and preserves textarea Enter',async t=>{
  const f=fixture(t),editor=f.api.createEditor(f.field,{doc:doc('公式和表格')});await editor.ready;await editor.setAdvanced(true);f.field.querySelector('button[aria-label="行内公式"]').click();
  let nativeSubmits=0;const dialog=f.field.querySelector('dialog'),form=dialog.querySelector('form'),confirm=dialog.querySelector('.qfrt-dialog-actions button:last-child'),latex=dialog.querySelector('textarea');form.addEventListener('submit',()=>nativeSubmits++);assert.equal(confirm.type,'button');
  confirm.click();assert.equal(f.field.querySelector('dialog'),dialog);latex.value='x^2';const newline=new f.dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});latex.dispatchEvent(newline);assert.equal(newline.defaultPrevented,false);assert.equal(f.field.querySelector('dialog'),dialog);
  confirm.click();assert.equal(f.field.querySelector('dialog'),null);assert.equal(nativeSubmits,0);await editor.flush();assert.equal(editor.getDocument().content.some(node=>node.content?.some(value=>value.type==='inlineMath'&&value.attrs.latex==='x^2')),true);
  f.field.querySelector('button[aria-label="插入表格"]').click();const tableDialog=f.field.querySelector('dialog'),inputs=tableDialog.querySelectorAll('input');inputs[0].value='0';tableDialog.querySelector('.qfrt-dialog-actions button:last-child').click();assert.equal(f.field.querySelector('dialog'),tableDialog);inputs[0].value='2';inputs[1].value='2';const enter=new f.dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});inputs[1].dispatchEvent(enter);assert.equal(enter.defaultPrevented,true);assert.equal(f.field.querySelector('dialog'),null);await editor.flush();const table=editor.getDocument().content.find(node=>node.type==='table');assert.equal(table.content.length,2);assert.equal(table.content[0].content.length,2);editor.destroy();
});
