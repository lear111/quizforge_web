import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createQuestionCache} from '../web/question-cache.js';
import {questionExtension,collectionHasExtension,extensionPageRoute,sameQuestionStamp} from '../web/extension-pages.js';
import {contextFor,collectionFeature,practiceSaveLabel,canViewDraft,draftViewActive} from '../web/practice-context.js';
import {createHistoryView} from '../web/history-view.js';
import {prepareExtensionAssets} from '../web/page-assets.js';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const functionSource=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const routingSource=functionSource('async function loadQuestion(', '\nfunction makeWriteQueue(')+functionSource('async function showQuestion(', '\nfunction syncPracticeCamera(')+functionSource('async function showHistoryQuestion(', '\nfunction disposeEditorSession(');
const single={id:'choice',version:'1.0.0',name:'选择题'},text={id:'text',version:'2.0.0',name:'简答题'};
const payload=(id,extension,packageVersion=extension.id)=>({question:{id,title:id,data:{}},extension,stamp:{revision:0,contentVersion:id,packageVersion},state:{revision:0,status:'unanswered',answer:null,result:null},draft:null});

function fixture({requestImpl,collection}={}){
  const mounted=[],requests=[],cache=createQuestionCache({schedule:null}),pages=createQuestionCache({schedule:null,capacity:4,maxBytes:4*1024*1024});
  let live=0,maxLive=0;
  class Element{
    constructor(){this.children=[];this.dataset={};const names=new Set();this.classList={remove(...values){values.forEach(value=>names.delete(value));},add(value){names.add(value);},contains:value=>names.has(value),toggle(){}};}
    setAttribute(){}
    addEventListener(){}
    prepend(...children){this.children.unshift(...children);for(const child of children)child.parent=this;}
    append(...children){this.children.push(...children);for(const child of children)child.parent=this;}
    replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
  }
  const pane={kind:'bank',id:'mixed',key:'bank:mixed',node:new Element(),frameHost:new Element(),viewport:{clientWidth:900,scrollTop:0,scrollLeft:0},tools:{},collection:collection||{extension:null,extensions:[single,text],questions:[{id:'a',type:single},{id:'b',type:text},{id:'c',type:single}],states:{}},ink:{clear(){}},whiteboard:{loads:[],load(value){this.loads.push(value);},setReadOnly(value){this.readOnly=value;},setMode(value){this.mode=value;}},view:'practice',plugin:null,draftMode:false};
  const sandbox={performance:{now:()=>0},setTimeout,clearTimeout,structuredClone,Math,questionExtension,collectionHasExtension,extensionPageRoute,sameQuestionStamp,contextFor,collectionFeature,practiceSaveLabel,canViewDraft,draftViewActive,
    questionsCache:cache,pagesCache:pages,questionCacheKey:(pane,qid)=>`${pane.key}:${qid}`,
    questionPath:(_kind,_id,qid)=>`/api/questions/${qid}`,collectionPath:()=>'/api/collections/bank/mixed',
    request:async(path,options)=>{requests.push({path,options});return requestImpl(path,options);},
    prepareAssets:assets=>prepareExtensionAssets(assets,async dependency=>({id:dependency.id,version:dependency.version,script:'frozen SDK',style:''})),el:()=>new Element(),active:()=>pane,
    disposeEditorSession(){},disposeScoreSummary(){},syncPracticeCamera(){},renderOutline(){},updateChrome(){},saveStatus(){},setEditorLayout(){},pageRequest(){},notice(){},
    mountExtension(container,assets,context){
      const frame=new Element();container.append(frame);live++;maxLive=Math.max(maxLive,live);let destroyed=false;
      const plugin={frame,ready:Promise.resolve(),destroy(){if(destroyed)return;destroyed=true;live--;frame.remove();}};
      mounted.push({assets,context,plugin});return plugin;
    },
  };
  vm.runInNewContext(`${routingSource}\nglobalThis.host={showQuestion,loadQuestion,showHistoryQuestion};`,sandbox);
  return {pane,requests,mounted,cache,pages,...sandbox.host,get live(){return live;},get maxLive(){return maxLive;}};
}

test('mixed navigation routes each question to its own assets and mounts only the current iframe',async()=>{
  const values={a:payload('a',single),b:payload('b',text),c:payload('c',single)};
  const f=fixture({requestImpl:async path=>{
    if(path==='/api/extensions/choice/1.0.0/page')return {html:'choice',script:'choice script',style:''};
    if(path==='/api/extensions/text/2.0.0/page')return {html:'text',script:'text script',style:''};
    throw new Error(`Unexpected request ${path}`);
  }});
  for(const id of ['a','b','c'])await f.showQuestion(f.pane,id,{payload:values[id]});
  assert.deepEqual(f.mounted.map(value=>value.assets.html),['choice','text','choice']);
  assert.deepEqual(f.mounted.map(value=>value.context.question.id),['a','b','c']);
  assert.equal(f.requests.length,2);assert.equal(f.maxLive,2);assert.equal(f.live,1);assert.equal(f.pane.frameHost.children.length,1);
  f.pane.plugin.destroy();
});

test('a changed question extension refreshes its outline and loads the exact new version',async()=>{
  const changed={...single,version:'3.0.0'},descriptor={extension:null,extensions:[changed,text],questions:[{id:'a',type:changed},{id:'b',type:text}],states:{}};
  const f=fixture({requestImpl:async path=>path==='/api/collections/bank/mixed'?descriptor:{html:'new version',script:'',style:''}});
  await f.showQuestion(f.pane,'a',{payload:payload('a',changed,'new fingerprint')});
  assert.deepEqual(f.requests.map(value=>value.path),['/api/collections/bank/mixed','/api/extensions/choice/3.0.0/page']);
  assert.equal(f.pane.collection,descriptor);assert.equal(f.mounted[0].assets.html,'new version');f.pane.plugin.destroy();
});

test('package-only stamp changes reload a cached question and its page',async()=>{
  const previous=payload('a',single,'old page'),current=payload('a',single,'new page');
  const f=fixture({requestImpl:async path=>{
    if(path.endsWith('/stamp'))return current.stamp;
    if(path==='/api/questions/a')return current;
    if(path==='/api/extensions/choice/1.0.0/page')return {html:'new frozen package',script:'',style:''};
    throw new Error(`Unexpected request ${path}`);
  }});
  f.cache.set('bank:mixed:a',previous);f.pages.set(extensionPageRoute(single,'old page').key,{html:'stale'});
  const fresh=await f.loadQuestion(f.pane,'a');
  assert.equal(fresh.stamp.packageVersion,'new page');assert.equal(f.pane.node.dataset.questionSource,'server');
  await f.showQuestion(f.pane,'a',{payload:fresh});assert.equal(f.mounted[0].assets.html,'new frozen package');
  assert.equal(f.requests.filter(value=>value.path==='/api/questions/a').length,1);f.pane.plugin.destroy();
});

test('ordinary mixed banks switch independent extensions in one folder without loading all runtimes',async()=>{
  const choice={id:'choice',version:'1.0.0',name:'单选',group:'语言题型'},essay={id:'essay',version:'1.0.0',name:'作文',group:'语言题型'};
  const collection={extension:null,extensions:[choice,essay],questions:[{id:'a',type:choice},{id:'b',type:essay},{id:'c',type:choice}],states:{}};
  const values={a:payload('a',choice,'same-fingerprint'),b:payload('b',essay,'same-fingerprint'),c:payload('c',choice,'same-fingerprint')};
  const f=fixture({collection,requestImpl:async path=>{
    if(path==='/api/extensions/choice/1.0.0/page')return {html:'choice type',script:'',style:''};
    if(path==='/api/extensions/essay/1.0.0/page')return {html:'essay type',script:'',style:''};
    throw new Error(`Unexpected request ${path}`);
  }});
  for(const id of ['a','b','c','b'])await f.showQuestion(f.pane,id,{payload:values[id]});
  assert.deepEqual(f.mounted.map(row=>row.assets.html),['choice type','essay type','choice type','essay type']);
  assert.equal(f.requests.length,2,'Repeated samples reuse only their matching type page.');assert.equal(f.maxLive,2);assert.equal(f.live,1);
  for(const row of f.mounted)assert.equal(row.context.mode,'practice');
  f.pane.plugin.destroy();
});

test('mixed extensions from one folder resolve only their own frozen history pages',async()=>{
  const choice={id:'choice',version:'1.0.0',name:'单选',group:'语言题型'},essay={id:'essay',version:'1.0.0',name:'作文',group:'语言题型'};
  const f=fixture({requestImpl:async()=>{throw new Error('History cannot fetch live package pages');}});
  f.pane.view='history';f.pane.historyView=createHistoryView({questions:[{payload:payload('a',choice),pageKey:'choice'},{payload:payload('b',essay),pageKey:'essay'}],pages:{choice:{html:'frozen choice',script:'',style:'',extension:choice},essay:{html:'frozen essay',script:'',style:'',extension:essay}}});
  await f.showHistoryQuestion(f.pane,'b');await f.showHistoryQuestion(f.pane,'a');
  assert.deepEqual(f.mounted.map(row=>row.assets.html),['frozen essay','frozen choice']);assert.equal(f.maxLive,1);assert.equal(f.requests.length,0);f.pane.plugin.destroy();
});

test('mixed history mounts only referenced frozen assets with readonly capabilities',async()=>{
  const a={payload:payload('a',single),pageKey:'old-choice'},b={payload:payload('b',text),pageKey:'old-text'};
  const pages={'old-choice':{html:'frozen choice',script:'choice',style:'',extension:single},'old-text':{html:'frozen text',script:'text',style:'',extension:text}};
  const f=fixture({requestImpl:async()=>{throw new Error('History must not load a live extension');}});
  f.pane.view='history';f.pane.historyView=createHistoryView({questions:[a,b],pages,collection:{extension:null,questions:[{id:'b'},{id:'a'}]}});
  await f.showHistoryQuestion(f.pane,'b');await f.showHistoryQuestion(f.pane,'a');
  assert.deepEqual(f.mounted.map(value=>value.assets.html),['frozen text','frozen choice']);assert.equal(f.requests.length,0);assert.equal(f.maxLive,1);
  for(const {context}of f.mounted){assert.equal(context.mode,'history');for(const allowed of Object.values(context.capabilities))assert.equal(allowed,false);}
  assert.equal(f.pane.historyQuestion.payload.extension.id,'choice');f.pane.plugin.destroy();
});

test('incompatible practice assets leave the current iframe, answer and ink in place',async()=>{
  const f=fixture({requestImpl:async path=>path.includes('/choice/')?{html:'old choice',script:'',style:''}:{html:'future',script:'',style:'',apiVersion:{major:2,minor:0}}});
  await f.showQuestion(f.pane,'a',{payload:payload('a',single)});
  const plugin=f.pane.plugin,previous=f.pane.payload,loads=f.pane.whiteboard.loads.length;
  await assert.rejects(f.showQuestion(f.pane,'b',{payload:payload('b',text)}),error=>error.code==='UNSUPPORTED_API_VERSION');
  assert.equal(f.pane.plugin,plugin);assert.equal(f.live,1);assert.equal(f.mounted.length,1);
  assert.equal(f.pane.payload,previous);assert.equal(f.pane.questionId,'a');assert.equal(f.pane.whiteboard.loads.length,loads);assert.equal(f.pane.loading,false);
  f.pane.plugin.destroy();
});

test('history keeps API metadata while resolving frozen libraries and mounting a readonly page',async()=>{
  const page={html:'frozen',script:'',style:'',extension:single,apiVersion:{major:1,minor:0},dependencies:[{id:'quizforge.richtext',version:'1.0.0'}]};
  const f=fixture({requestImpl:async()=>{throw new Error('History must not load a live extension');}});
  f.pane.view='history';f.pane.historyView=createHistoryView({questions:[{payload:payload('a',single),pageKey:'frozen'}],pages:{frozen:page}});
  await f.showHistoryQuestion(f.pane,'a');
  const assets=f.mounted[0].assets;
  assert.deepEqual(assets.apiVersion,{major:1,minor:0});assert.equal(assets.libraries[0].version,'1.0.0');
  assert.equal(page.libraries,undefined,'Preparing a page must not mutate the stored history.');
  assert.equal(f.mounted[0].context.capabilities.canSave,false);f.pane.plugin.destroy();
});
