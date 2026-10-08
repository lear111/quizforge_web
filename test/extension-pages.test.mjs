import test from 'node:test';
import assert from 'node:assert/strict';
import {questionExtension,collectionExtensions,collectionHasExtension,extensionPageRoute,sameQuestionStamp,unusedPagePrefixes} from '../web/extension-pages.js';

const single={id:'single',version:'1.0.0',name:'单选'},multi={id:'multi',version:'1.0.0',name:'多选'},newSingle={...single,version:'2.0.0'};
const mixed={extension:null,extensions:[single,multi,newSingle],questions:[{id:'a',type:single},{id:'b',type:multi},{id:'c',type:newSingle}]};

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
