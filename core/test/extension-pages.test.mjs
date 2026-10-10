import test from 'node:test';
import assert from 'node:assert/strict';
import {questionExtension,collectionExtensions,collectionHasExtension,extensionPageRoute,sameQuestionStamp,unusedPagePrefixes,sameExtension,extensionPagePrefix} from '../web/extension-pages.js';

const single={id:'single',version:'1.0.0',name:'单选'},multi={id:'multi',version:'1.0.0',name:'多选'},newSingle={...single,version:'2.0.0'};
const mixed={extension:null,extensions:[single,multi,newSingle],questions:[{id:'a',type:single},{id:'b',type:multi},{id:'c',type:newSingle}]};

test('development asset routing and cache ownership cannot collide with a formal package identity',()=>{
  const formal={id:'dev.demo',version:'0.0.0'},development={...formal,development:{folder:'demo',mode:'runtime'}};
  assert.deepEqual(extensionPageRoute(development,'new-files'),{key:'development:demo:new-files',path:'/api/development/extensions/demo/page'});
  assert.notEqual(extensionPageRoute(development,'stamp').key,extensionPageRoute(formal,'stamp').key);
  assert.equal(collectionHasExtension({extension:formal,questions:[{id:'q'}]},'q',development),false);
  assert.equal(collectionExtensions({extensions:[formal,development]}).length,2);
  assert.deepEqual(unusedPagePrefixes({collection:{extension:development}},[{collection:{extension:formal}}]),['development:demo:']);
  assert.deepEqual(unusedPagePrefixes({collection:{extension:development}},[{collection:{extension:development}}]),[]);
});

test('question page routes follow payload extension in mixed and old single-extension banks',()=>{
  assert.equal(questionExtension({question:{id:'b'},extension:multi},mixed),multi);
  assert.equal(questionExtension({question:{id:'a'},extension:newSingle},mixed),newSingle);
  assert.equal(questionExtension({question:{id:'b'}},mixed),multi);
  assert.equal(questionExtension({question:{id:'old'}},{extension:single}),single);
  assert.equal(collectionHasExtension(mixed,'b',multi),true);assert.equal(collectionHasExtension(mixed,'a',newSingle),false);
  assert.equal(collectionHasExtension({extension:single,questions:[{id:'old'}]},'old',single),true);
  assert.deepEqual(extensionPageRoute(newSingle,'fingerprint'),{key:'single:2.0.0:fingerprint',path:'/api/extensions/single/2.0.0/page'});
  assert.throws(()=>questionExtension({question:{id:'missing'}},mixed),/缺少有效/);
});

test('stamp checks invalidate page fingerprint changes without discarding unchanged question state',()=>{
  const stamp={revision:5,contentVersion:'question',packageVersion:'page-a'};
  assert.equal(sameQuestionStamp(stamp,{...stamp}),true);
  assert.equal(sameQuestionStamp(stamp,{...stamp,packageVersion:'page-b'}),false);
  assert.equal(sameQuestionStamp(stamp,{...stamp,contentVersion:'changed'}),false);
  assert.equal(sameQuestionStamp(stamp,{...stamp,revision:6}),false);
});

test('closing a mixed tab evicts only exact extension versions no other tab references',()=>{
  assert.deepEqual(collectionExtensions(mixed),[single,multi,newSingle]);
  const pane={collection:mixed},remaining=[{collection:{extension:multi}},{collection:{extension:newSingle}}];
  assert.deepEqual(unusedPagePrefixes(pane,remaining),['single:1.0.0:']);
  assert.deepEqual(unusedPagePrefixes(pane,[]),['single:1.0.0:','multi:1.0.0:','single:2.0.0:']);
  assert.deepEqual(unusedPagePrefixes({collection:{extension:single},payload:{extension:newSingle}},[{collection:{extension:single}}]),['single:2.0.0:']);
});

test('physical groups never affect independent extension routes, cache entries or ownership',()=>{
  const choice={id:'quizforge.choice',version:'1.0.0',name:'单选',group:'语言题型'},essay={id:'quizforge.essay',version:'1.0.0',name:'作文',group:'语言题型'};
  assert.equal(sameExtension(choice,essay),false);assert.equal(sameExtension(choice,{...choice,group:'其他题型',name:'改名'}),true);
  assert.deepEqual(extensionPageRoute(essay,'shared-fingerprint'),{key:'quizforge.essay:1.0.0:shared-fingerprint',path:'/api/extensions/quizforge.essay/1.0.0/page'});
  const development={...essay,development:{folder:'essay-dev'}};
  assert.equal(extensionPageRoute(development,'files').path,'/api/development/extensions/essay-dev/page');
  assert.deepEqual(extensionPageRoute(development,'files'),extensionPageRoute({...development,group:'其他组'},'files'));
  assert.notEqual(extensionPageRoute(choice,'shared-fingerprint').key,extensionPageRoute(essay,'shared-fingerprint').key);
  assert.equal(collectionExtensions({extensions:[choice,essay]}).length,2);
  const close={collection:{extensions:[choice,essay]}},remaining=[{collection:{extension:essay}}];
  assert.deepEqual(unusedPagePrefixes(close,remaining),[extensionPagePrefix(choice)]);
  assert.equal(collectionHasExtension({questions:[{id:'q',type:essay}]},'q',choice),false);
});
