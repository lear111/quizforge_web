import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {inlinePageAssets,prepareLegacyPage} from '../web/development-preview.js';
import {resolveExtensionApi} from '../web/api-bridges.js';

const frameSource=readFileSync(new URL('../web/frame.js',import.meta.url),'utf8');
function documentFor(page,context){
  const host=new JSDOM('<main></main>');let id=0;
  const sandbox={document:host.window.document,window:host.window,makeRequestId:()=>`fixture-${++id}`,resolveExtensionApi,inlinePageAssets,prepareLegacyPage,setTimeout,clearTimeout};
  vm.runInNewContext(frameSource.replace(/^import[^\r\n]*\r?\n/gm,'').replace('export function mountExtension','function mountExtension')+'\nglobalThis.mount=mountExtension;',sandbox);
  const mounted=sandbox.mount(host.window.document.querySelector('main'),{html:'',style:'',script:'',...page},context,{onError(){}});
  const html=mounted.frame.srcdoc;mounted.destroy();host.window.close();return html;
}

test('legacy HTML uses the real extension sandbox with readonly immutable fixture data and automatic minimum registration',async t=>{
  const sent=[],html=documentFor({legacyPage:true,html:'<h2></h2><button id="submit">提交答案</button><p id="feedback" hidden>示例反馈</p>',script:'document.querySelector("h2").textContent=QF_PREVIEW.question.title;document.getElementById("submit").addEventListener("click",()=>document.getElementById("feedback").hidden=false);'}, {mode:'example',development:{folder:'old'},question:{id:'q',title:'</script><script>unexpected=true;</script>',data:{stem:'材料'}},capabilities:{canSave:true}});
  const page=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(window){window.structuredClone=structuredClone;window.ResizeObserver=class{observe(){}disconnect(){}};window.postMessage=value=>sent.push(value);}});t.after(()=>page.window.close());
  await new Promise(resolve=>page.window.addEventListener('load',resolve,{once:true}));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(page.window.document.querySelector('h2').textContent,'</script><script>unexpected=true;</script>');assert.equal(page.window.unexpected,undefined);assert.ok(page.window.QF.page.register);assert.equal(Object.isFrozen(page.window.QF_PREVIEW.question.data),true);assert.equal(Object.getOwnPropertyDescriptor(page.window,'QF_PREVIEW').writable,false);
  assert.ok(sent.some(value=>value.kind==='registered'&&value.channel==='quizforge-extension'));assert.equal(sent.some(value=>value.channel==='quizforge-development-preview'),false);
  const saved=await page.window.QF.save({purpose:'submit',data:{answer:'demo'}});assert.equal(saved.ok,false);assert.equal(saved.error.code,'DEVELOPMENT_NOT_IMPLEMENTED');assert.equal(sent.some(value=>value.kind==='request'&&value.method==='save'),false);
  page.window.document.getElementById('submit').click();assert.equal(page.window.document.getElementById('feedback').hidden,false);
});

test('full legacy documents retain declared local media and inline scripts after QF boot, with external surfaces removed',()=>{
  const host=new JSDOM('');const page=prepareLegacyPage({html:'<!doctype html><html><head><style>.title{color:purple}</style><link rel="stylesheet" href="https://cdn.invalid/a.css"></head><body class="sample"><img src="./assets/sample.png" onload="fetch(\'/api/catalog\')"><a href="https://example.com">链接</a><iframe src="https://example.com"></iframe><script src="demo.js"></script><script>window.inlineDemo=QF_PREVIEW.question.title;</script></body></html>',script:'window.fileDemo=true;',style:'@import "https://cdn.invalid/a.css";.icon{background:url(assets/sample.png)}',assets:[{path:'assets/sample.png',mime:'image/png',data:'aGVsbG8='}]},{document:host.window.document});
  const doc=new JSDOM(page.bodyTag+page.html).window.document;
  assert.equal(doc.body.className,'sample');assert.match(doc.querySelector('img').src,/^data:image\/png;base64,aGVsbG8=/);assert.equal(doc.querySelector('img').hasAttribute('onload'),false);assert.equal(doc.querySelector('a').hasAttribute('href'),false);assert.equal(doc.querySelector('link'),null);assert.equal(doc.querySelector('iframe'),null);assert.equal(doc.querySelector('script'),null);assert.match(page.script,/inlineDemo/);assert.match(page.script,/fileDemo/);assert.match(page.style,/color:purple/);assert.doesNotMatch(page.style,/@import/);
  host.window.close();doc.defaultView.close();
});

test('formal and development pages retain the same declared local HTML and CSS media',()=>{
  const dom=new JSDOM('');const page={html:'<html><head><style>.banner{background:url(../assets/image.png)}</style></head><body class="preview" data-label="A > B"><img src="../assets/image.png"></body></html>',entryPath:'pages/practice.html',stylePath:'css/preview.css',style:'.icon{background:url(../assets/image.png)}',assets:[{path:'assets/image.png',mime:'image/png',base64:'aGVsbG8='}]};
  const prepared=inlinePageAssets(page,{document:dom.window.document});assert.match(prepared.html,/data:image\/png;base64,aGVsbG8=/);assert.equal((prepared.style.match(/data:image\/png;base64,aGVsbG8=/g)||[]).length,2);assert.match(prepared.bodyTag,/class="preview"/);assert.match(prepared.bodyTag,/A &gt; B/);assert.equal(page.html.includes('data:image'),false);dom.window.close();
});
