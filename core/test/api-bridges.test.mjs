import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolveExtensionApi} from '../web/api-bridges.js';
import {prepareExtensionAssets} from '../web/page-assets.js';

const frameSource=readFileSync(new URL('../web/frame.js',import.meta.url),'utf8');
const capabilities=['practice','editor','editor-drafts','score','manual-review','ai-grading','resources','richtext','navigation','lifecycle'];

test('version selection defaults old pages to v1 and refuses malformed or newer contracts',()=>{
  const legacy=resolveExtensionApi();
  assert.equal(resolveExtensionApi({major:1,minor:0}),legacy);
  assert.deepEqual(legacy.api,{major:1,minor:0,capabilities});
  for(const version of [null,'1.0',[],{},1,{major:1},{major:1,minor:-1},{major:'1',minor:0},{major:0,minor:0},{major:1,minor:0.5}]) {
    assert.throws(()=>resolveExtensionApi(version),error=>error.code==='INVALID_API_VERSION');
  }
  for(const version of [{major:2,minor:0},{major:1,minor:1}]) {
    assert.throws(()=>resolveExtensionApi(version),error=>error.code==='UNSUPPORTED_API_VERSION'&&error.message.includes(`${version.major}.${version.minor}`));
  }
});

test('the actual selected iframe bridge exposes frozen host metadata while legacy save and lifecycle still work',async()=>{
  const bridge=resolveExtensionApi(),sent=[],listeners=new Map(),timers=new Map();let nextTimer=0,disposed=0,loaded;
  const parent={postMessage:message=>sent.push(structuredClone(message))};
  const context={mode:'practice',question:{id:'old-choice'},capabilities:{canSave:false}};
  const boot={session:'legacy',context,api:bridge.api};
  const sandbox={parent,Promise,structuredClone,document:{body:{scrollHeight:100},documentElement:{}},ResizeObserver:class{observe(){}disconnect(){}},
    setTimeout(callback){const id=++nextTimer;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),addEventListener:(name,callback)=>listeners.set(name,callback)};
  // Evaluate exactly what mountExtension serializes, with no access to the module's closure.
  vm.runInNewContext(`(${bridge.bootstrap.toString()})(${JSON.stringify(boot)});`,sandbox);
  const {QF}=sandbox;
  assert.deepEqual(structuredClone(QF.api),{major:1,minor:0,capabilities});
  assert.equal(Object.isFrozen(QF),true);assert.equal(Object.isFrozen(QF.api),true);assert.equal(Object.isFrozen(QF.api.capabilities),true);
  assert.throws(()=>QF.api.capabilities.push('internal-code'));
  await QF.page.register({onLoad:value=>{loaded=value;},onDispose:()=>{disposed++;}});
  assert.equal(loaded.capabilities.canSave,false,'Host API support must not grant write permissions.');
  const saving=QF.save({purpose:'draft',data:{answer:{selectedOptionId:'B'}}});
  const request=sent.find(value=>value.kind==='request');
  assert.equal(request.method,'save');assert.deepEqual(request.args,{purpose:'draft',data:{answer:{selectedOptionId:'B'}}});
  const receive=value=>listeners.get('message')({source:parent,data:{...value,channel:'quizforge-host',session:'legacy'}});
  receive({kind:'reply',id:request.id,reply:{ok:true,data:{status:'draft'}}});assert.equal((await saving).data.status,'draft');
  receive({kind:'dispose'});assert.equal(disposed,1);assert.equal(timers.size,0);
  assert.equal((await QF.save({purpose:'draft'})).error.code,'PAGE_CLOSED');
});

test('mount rejects unsupported versions before creating an iframe, timer or listener',()=>{
  let created=0,timers=0,listeners=0,appended=0;
  const sandbox={resolveExtensionApi,makeRequestId:()=>{throw new Error('No ID should be needed');},
    document:{createElement(){created++;}},window:{addEventListener(){listeners++;}},setTimeout(){timers++;}};
  const source=frameSource.replace(/^import[^\r\n]*\r?\n/gm,'').replace('export function mountExtension','function mountExtension');
  vm.runInNewContext(`${source}\nglobalThis.mount=mountExtension;`,sandbox);
  for(const apiVersion of [{major:2,minor:0},{major:1,minor:1},null]) {
    assert.throws(()=>sandbox.mount({append(){appended++;}},{apiVersion}, {},{}),error=>['UNSUPPORTED_API_VERSION','INVALID_API_VERSION'].includes(error.code));
  }
  assert.deepEqual([created,timers,listeners,appended],[0,0,0,0]);
});

test('page preparation validates before SDK loading and preserves both old and versioned frozen assets',async()=>{
  let loads=0;
  await assert.rejects(prepareExtensionAssets({apiVersion:{major:2,minor:0},dependencies:[{id:'future'}]},()=>{loads++;}),error=>error.code==='UNSUPPORTED_API_VERSION');
  assert.equal(loads,0);
  for(const metadata of [{},{apiVersion:{major:1,minor:0}}]) {
    const assets={html:'frozen',script:'old script',style:'',...metadata,dependencies:[{id:'quizforge.richtext',version:'1.0.0'}]},library={script:'frozen SDK',style:''};
    const prepared=await prepareExtensionAssets(assets,async dependency=>{assert.equal(dependency.version,'1.0.0');loads++;return library;});
    assert.equal(prepared.apiVersion,assets.apiVersion);assert.equal(prepared.script,assets.script);assert.deepEqual(prepared.libraries,[library]);
    assert.equal(Object.hasOwn(assets,'libraries'),false);
  }
  assert.equal(loads,2);
});
