import test from 'node:test';
import assert from 'node:assert/strict';
import {consecutiveQuestionGroups} from '../web/outline-groups.js';
test('matrix groups adjacent types without moving a later recurring type forward',()=>{
  const questions=['single','multi','single','single','multi'].map((id,index)=>({id:String(index),type:{id,name:id}}));
  const groups=consecutiveQuestionGroups(questions);
  assert.deepEqual(groups.map(group=>[group.typeId,group.items.map(item=>item.number)]),[['single',[1]],['multi',[2]],['single',[3,4]],['multi',[5]]]);
  assert.deepEqual(groups.flatMap(group=>group.items.map(item=>item.question)),questions);
});
test('existing single-package banks form one matrix; empty banks have no groups',()=>{
  assert.deepEqual(consecutiveQuestionGroups([]),[]);
  const groups=consecutiveQuestionGroups([{id:'a'},{id:'b'}],{id:'package.single',name:'单选'});
  assert.equal(groups.length,1);assert.equal(groups[0].name,'单选');assert.deepEqual(groups[0].items.map(item=>item.number),[1,2]);
});

test('mixed matrices separate adjacent versions and preserve recurring groups and numbering',()=>{
  const questions=['1','2','2','1'].map((version,index)=>({id:String(index),type:{id:'same',version,name:'同题型'}}));
  const groups=consecutiveQuestionGroups(questions,null);
  assert.deepEqual(groups.map(group=>[group.typeId,group.version,group.items.map(item=>item.number)]),[['same','1',[1]],['same','2',[2,3]],['same','1',[4]]]);
  assert.deepEqual(consecutiveQuestionGroups([{id:'fallback'}],null).map(group=>group.name),['题目']);
});

test('physical folder groups never merge different question types or split a relocated extension',()=>{
  const choice={id:'choice',version:'1.0.0',name:'单选',group:'语言题型'},essay={id:'essay',version:'1.0.0',name:'作文',group:'语言题型'};
  const types=[choice,essay,essay,choice,{...choice,group:'其他分组'},{...choice,development:{folder:'choice-dev'}}];
  const groups=consecutiveQuestionGroups(types.map((type,index)=>({id:String(index),type})));
  assert.deepEqual(groups.map(group=>[group.typeId,group.name,group.items.map(item=>item.number)]),[['choice','单选',[1]],['essay','作文',[2,3]],['choice','单选',[4,5]],['choice','单选',[6]]]);
});

test('old readonly mixed-package metadata keeps its frozen names and original order',()=>{
  const choice={id:'old-languages',version:'1.0.0',typeId:'choice',name:'单选'},essay={...choice,typeId:'essay',name:'作文'};
  assert.deepEqual(consecutiveQuestionGroups([choice,essay,choice].map((type,index)=>({id:String(index),type}))).map(group=>[group.name,group.items.map(item=>item.number)]),[['单选',[1]],['作文',[2]],['单选',[3]]]);
});
