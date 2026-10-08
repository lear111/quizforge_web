import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {bootstrapV1} from '../web/api-v1.js';
import {resolveExtensionApi} from '../web/api-bridges.js';
import {prepareExtensionAssets,validateContentApi} from '../web/page-assets.js';
import {createExtensionRouter} from '../web/extension-requests.js';

const basic=['basic-formatting','images'],advanced=[...basic,'advanced-formatting','tables','math','image-resize'];
const contract=profile=>({major:1,minor:0,documentFormat:1,documentProfile:profile,capabilities:profile==='advanced-v1'?advanced:basic});
const doc=text=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function bridgeFixture(settings={}){
  const {version='1.1.2',declare=true}=settings,contentApi=Object.hasOwn(settings,'contentApi')?settings.contentApi:contract('advanced-v1');
  const listeners=new Map(),sent=[],configured=[],calls=[],timers=new Map();let timerId=0;
  const parent={postMessage:message=>sent.push(structuredClone(message))};
  const provider={version,configure:options=>configured.push(options),EMPTY_DOCUMENT:{type:'doc',content:[{type:'paragraph'}]},IMAGE_TYPES:new Set(['image/png','image/jpeg']),FONT_FAMILIES:['Arial'],FONT_SIZES:['16px'],LINE_HEIGHTS:['1.5'],_createEditor(){throw new Error('private engine');}};
  for(const name of ['render','createEditor','cloneDocument','validateDocument','isEmpty','fromEditorDocument'])provider[name]=(...args)=>{calls.push({name,args});return name==='cloneDocument'?structuredClone(args[0]):name;};
  const sandbox={parent,Promise,structuredClone,QFRichText:provider,document:{body:{scrollHeight:100},documentElement:{},head:{append:script=>calls.push({name:'script',script})},createElement:()=>({})},ResizeObserver:class{observe(){}disconnect(){}},setTimeout(callback){const id=++timerId;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),addEventListener:(name,callback)=>listeners.set(name,callback)};
  const boot={session:'content-session',nonce:'host-nonce',context:{mode:'practice'},api:resolveExtensionApi().api,dependencies:declare?[{id:'quizforge.richtext',version}]:[],...(contentApi===undefined?{}:{contentApi})};
  vm.runInNewContext(`(${bootstrapV1.toString()})(${JSON.stringify(boot)});`,sandbox);
  const receive=value=>listeners.get('message')({source:parent,data:{...value,channel:'quizforge-host',session:boot.session}});
  return {QF:sandbox.QF,provider,configured,calls,sent,receive,timers};
}

test('QF.content is an immutable public facade rather than the concrete editor provider',()=>{
  const f=bridgeFixture(),content=f.QF.content;
  assert.notEqual(content,f.provider);assert.equal(content.version,'1.0.0');
  assert.deepEqual(plain(content.api),contract('advanced-v1'));
  assert.equal(Object.isFrozen(content),true);assert.equal(Object.isFrozen(content.api),true);assert.equal(Object.isFrozen(content.api.capabilities),true);
  for(const internal of ['configure','_createEditor','loadEditor','setExpanded'])assert.equal(content[internal],undefined);
  assert.equal(f.QF.content,content);assert.equal(f.configured.length,1);
  const input=doc('保留内容');assert.deepEqual(content.cloneDocument(input),input);assert.equal(content.validateDocument(input),'validateDocument');
  assert.deepEqual(f.calls.map(value=>value.name),['cloneDocument','validateDocument']);
  assert.equal(Object.isFrozen(content.EMPTY_DOCUMENT.content[0]),true);
  assert.throws(()=>{content.EMPTY_DOCUMENT.content.push({type:'image'});});assert.throws(()=>{content.FONT_FAMILIES.push('new font');});
  assert.deepEqual([...content.IMAGE_TYPES],['image/png','image/jpeg']);assert.equal(content.IMAGE_TYPES.has('image/png'),true);assert.equal(content.IMAGE_TYPES.add,undefined);
  assert.equal(f.provider.EMPTY_DOCUMENT.content.length,1);assert.deepEqual(f.provider.FONT_FAMILIES,['Arial']);
  f.receive({kind:'dispose'});assert.throws(()=>content.render({},input),error=>error.code==='PAGE_CLOSED');
});

test('legacy frozen metadata is inferred from its exact selected dependency, never the provider version',()=>{
  for(const [version,profile,caps] of [['1.0.0','basic-v1',basic],['1.1.0','advanced-v1',advanced],['1.1.1','advanced-v1',advanced]]){
    const f=bridgeFixture({version,contentApi:undefined});f.provider.version='100.0.0';
    assert.equal(f.QF.content.api.documentProfile,profile);assert.deepEqual([...f.QF.content.api.capabilities],caps);assert.equal(f.QF.content.version,'1.0.0');
    f.receive({kind:'dispose'});
  }
  const unknown=bridgeFixture({version:'9.9.9',contentApi:undefined});assert.equal(unknown.QF.content.api,null);assert.equal(unknown.QF.content.version,'1.0.0');assert.equal(unknown.QF.content.render({},doc('原样读取')),'render');unknown.receive({kind:'dispose'});
  const missing=bridgeFixture({declare:false});assert.throws(()=>missing.QF.content,/没有声明/);assert.equal(missing.configured.length,0);missing.receive({kind:'dispose'});
});

test('lazy editor requests use concrete resolved dependencies and retain exact historical versions',async()=>{
  for(const version of ['1.1.2','1.1.0']){
    const f=bridgeFixture({version,contentApi:version==='1.1.0'?undefined:contract('advanced-v1')});void f.QF.content;
    assert.equal(f.sent.length,0,'Reading or rendering content must not load the heavy editor.');
    const loading=f.configured[0].loadEditor(),second=f.configured[0].loadEditor();assert.equal(loading,second);
    const request=f.sent.find(value=>value.method==='sdk-editor');assert.deepEqual(request.args,{id:'quizforge.richtext',version});
    f.receive({kind:'reply',id:request.id,reply:{ok:true,data:{script:'exact selected editor'}}});await loading;
    assert.equal(f.calls.at(-1).script.nonce,'host-nonce');assert.equal(f.calls.at(-1).script.textContent,'exact selected editor');assert.equal(f.timers.size,0);
    f.receive({kind:'dispose'});
  }
});

test('page preparation rejects unsupported content contracts before any provider is loaded',async()=>{
  let loads=0;const load=async()=>{loads++;return {script:'static provider',style:''};};
  for(const contentApi of [{...contract('advanced-v1'),major:2},{...contract('basic-v1'),capabilities:['tables']}])await assert.rejects(prepareExtensionAssets({contentApi,dependencies:[{id:'quizforge.richtext',version:'1.1.2'}]},load),error=>error.code==='UNSUPPORTED_CONTENT_API');
  await assert.rejects(prepareExtensionAssets({contentApi:null},load),error=>error.code==='INVALID_CONTENT_API');assert.equal(loads,0);
  const page={contentApi:contract('advanced-v1'),dependencies:[{id:'quizforge.richtext',version:'1.1.2'}],script:'unchanged extension'};
  const prepared=await prepareExtensionAssets(page,load);assert.equal(prepared.contentApi,page.contentApi);assert.equal(prepared.script,page.script);assert.equal(page.libraries,undefined);assert.equal(loads,1);
  const source=readFileSync(new URL('../web/frame.js',import.meta.url),'utf8').replace(/^import[^\r\n]*\r?\n/gm,'').replace('export function mountExtension','function mountExtension');
  const created=[],sandbox={resolveExtensionApi,validateContentApi,document:{createElement:()=>created.push('frame')},makeRequestId:()=>created.push('id')};
  vm.runInNewContext(`${source}\nglobalThis.mount=mountExtension;`,sandbox);
  assert.throws(()=>sandbox.mount({}, {...page,contentApi:{...page.contentApi,minor:1}}, {},{}),error=>error.code==='UNSUPPORTED_CONTENT_API');assert.deepEqual(created,[],'Direct mount must validate before IDs, iframes or scripts are created.');
});

test('router authorizes only the concrete provider selected for the active or frozen page',async()=>{
  const loads=[],route=createExtensionRouter({loadSdk:async(id,version)=>{loads.push([id,version]);return {script:version};}});
  const pane={view:'practice',pageAssets:{contentApi:contract('advanced-v1'),dependencies:[{id:'quizforge.richtext',version:'1.1.2'}]},historyQuestion:{page:{dependencies:[{id:'quizforge.richtext',version:'1.1.0'}]}}};
  assert.equal((await route(pane,'sdk-editor',{id:'quizforge.richtext',version:'1.0.0'})).error.code,'SDK_UNAVAILABLE');
  assert.equal((await route(pane,'sdk-editor',{id:'quizforge.richtext',version:'1.1.2'})).data.script,'1.1.2');pane.view='history';
  assert.equal((await route(pane,'sdk-editor',{id:'quizforge.richtext',version:'1.1.2'})).error.code,'SDK_UNAVAILABLE');
  assert.equal((await route(pane,'sdk-editor',{id:'quizforge.richtext',version:'1.1.0'})).data.script,'1.1.0');assert.deepEqual(loads,[['quizforge.richtext','1.1.2'],['quizforge.richtext','1.1.0']]);
});

test('the self-contained iframe facade renders and edits through actual immutable Tiptap packages',async t=>{
  for(const version of ['1.0.0','1.1.2']){
    const dom=new JSDOM('<!doctype html><main id="host"></main>',{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/'});t.after(()=>dom.window.close());
    const {window}=dom,sent=[];window.structuredClone=structuredClone;window.ResizeObserver=class{observe(){}disconnect(){}};
    window.postMessage=message=>sent.push(plain(message));
    const light=readFileSync(new URL(`../shared/richtext/${version}/richtext.js`,import.meta.url),'utf8'),heavy=readFileSync(new URL(`../shared/richtext/${version}/richtext-editor.js`,import.meta.url),'utf8');
    const boot={session:`real-${version}`,nonce:'host',context:{mode:'practice'},api:resolveExtensionApi().api,dependencies:[{id:'quizforge.richtext',version}],...(version==='1.1.2'?{contentApi:contract('advanced-v1')}:{})};
    window.eval(`(${bootstrapV1.toString()})(${JSON.stringify(boot)});`);window.eval(light);
    const content=window.QF.content,host=window.document.getElementById('host'),value=doc('统一文档格式');
    const formula={type:'doc',content:[{type:'blockMath',attrs:{latex:'x+1'}}]};
    assert.equal(content.validateDocument(formula),version==='1.1.2','The legacy basic profile must not acquire nodes rejected by its unchanged rules.');
    const view=content.render(host,value);await view.ready;assert.equal(host.textContent,'统一文档格式');assert.equal(sent.some(item=>item.method==='sdk-editor'),false);view.destroy();
    const editor=content.createEditor(host,{doc:value});await tick();const request=sent.find(item=>item.method==='sdk-editor');assert.deepEqual(request.args,{id:'quizforge.richtext',version});
    window.dispatchEvent(new window.MessageEvent('message',{source:window.parent,data:{channel:'quizforge-host',session:boot.session,kind:'reply',id:request.id,reply:{ok:true,data:{script:heavy}}}}));
    await editor.ready;await editor.flush();assert.deepEqual(plain(editor.getDocument()),value);assert.equal(host.querySelectorAll('.tiptap').length,1);editor.destroy();assert.equal(host.children.length,0);
    window.dispatchEvent(new window.MessageEvent('message',{source:window.parent,data:{channel:'quizforge-host',session:boot.session,kind:'dispose'}}));
  }
});
