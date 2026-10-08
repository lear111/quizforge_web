import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDocument,cloneDocument,fromEditorDocument,EMPTY_DOCUMENT,isEmpty} from '../shared/richtext/1.0.0/src/document.js';
const text=value=>({type:'paragraph',content:[{type:'text',text:value}]});
test('document validation preserves the supported rich text tree without sharing caller objects',()=>{
  const value={type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'标题',marks:[{type:'bold'}]}]},text('正文'),{type:'orderedList',attrs:{start:3},content:[{type:'listItem',content:[text('步骤')]}]},{type:'image',attrs:{assetId:'a'.repeat(64),alt:'图片'}}]};
  assert.equal(validateDocument(value,{requireContent:true}),true);const cloned=cloneDocument(value);assert.deepEqual(cloned,value);cloned.content[1].content[0].text='其他';assert.equal(value.content[1].content[0].text,'正文');assert.equal(isEmpty(EMPTY_DOCUMENT),true);
});
test('document limits and parent structure reject unsafe or oversized input',()=>{
  const invalid=[{type:'doc',content:[{type:'text',text:'direct text'}]},{type:'doc',content:[{type:'paragraph',content:[{type:'paragraph'}]}]},{type:'doc',content:[{type:'heading',attrs:{level:4}}]},{type:'doc',content:[{type:'image',attrs:{assetId:'A'.repeat(64)}}]},{type:'doc',content:[{type:'image',attrs:{assetId:'a'.repeat(64),src:'blob:must-not-persist'}}]},{type:'doc',content:[text('x'.repeat(100001))]}];
  for(const value of invalid)assert.equal(validateDocument(value),false);let value=text('deep');for(let i=0;i<33;i++)value={type:'blockquote',content:[value]};assert.equal(validateDocument({type:'doc',content:[value]}),false);
});
test('editor export strips runtime/default attributes while preserving semantic content',()=>{
  const value={type:'doc',content:[{type:'paragraph',attrs:{textAlign:null},content:[{type:'text',text:'链接',marks:[{type:'link',attrs:{href:'https://example.com/',target:'_blank',rel:'noopener'}}]}]},{type:'image',attrs:{assetId:'b'.repeat(64),src:'blob:ephemeral',alt:'图',title:null}},{type:'orderedList',attrs:{start:1,type:null},content:[{type:'listItem',content:[text('步骤')]}]}]};
  const clean=fromEditorDocument(value);assert.equal(JSON.stringify(clean).includes('blob:'),false);assert.deepEqual(clean.content[1].attrs,{assetId:'b'.repeat(64),alt:'图'});assert.equal(clean.content[2].attrs,undefined);assert.deepEqual(clean.content[0].content[0].marks,[{type:'link',attrs:{href:'https://example.com/'}}]);
});
