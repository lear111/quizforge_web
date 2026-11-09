import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const roots=['单选题','简答题'];
function reference(leaf){
  const root=new URL('../../../extensions/基础题型/'+leaf+'/',import.meta.url);
  const read=file=>readFileSync(new URL(file,root),'utf8');
  const manifest=JSON.parse(read('manifest.json'));
  const examples=JSON.parse(read(manifest.examples));
  let type;vm.runInNewContext(read(manifest.rules),{QF:{defineType:value=>{type=value;}}});
  return {manifest,examples,type};
}
for(const leaf of roots){
  test(leaf+' sample projections hide answer keys until submission',()=>{
    const {manifest,examples,type}=reference(leaf);
    assert.deepEqual(examples.extension,{path:'extensions/基础题型/'+leaf});
    for(const {data} of examples.questions){
      assert.equal(type.validateQuestion(data),true);
      const projected=JSON.parse(JSON.stringify(type.project(data,{submitted:false})));
      assert.equal(Object.hasOwn(projected,'correctOptionId'),false);
      assert.equal(Object.hasOwn(projected,'answerAndExplanation'),false);
      for(const part of projected.parts??[])assert.equal(Object.hasOwn(part,'answerAndExplanation'),false);
      const submitted=JSON.parse(JSON.stringify(type.project(data,{submitted:true})));
      if(data.parts)assert.deepEqual(submitted.parts.map(part=>part.answerAndExplanation),data.parts.map(part=>part.answerAndExplanation));
      else{assert.equal(submitted.correctOptionId,data.correctOptionId);assert.deepEqual(submitted.answerAndExplanation,data.answerAndExplanation);}
      assert.ok(Number.isFinite(type.getScore(data,{submitted:false}).maxScore));
    }
  });
  test(leaf+' grades a saved partial answer through its rule interface',()=>{
    const {examples,type}=reference(leaf),data=examples.questions[0].data;
    const answer=leaf==='单选题'?{selectedOptionId:data.correctOptionId}:{responses:{}};
    assert.equal(type.validateAnswer(answer,data),true);const result=type.grade(data,answer);assert.ok(Number.isFinite(result.score));assert.ok(Number.isFinite(result.maxScore));
  });
}
test('shared-material reference keeps its explicit parent outline and stable child scoring IDs',()=>{
  const {examples,type}=reference('简答题');
  const question=examples.questions.find(question=>question.data.parts.length>1);
  assert.ok(question,'The reference must include a shared-material example.');
  // The sample chooses a parent outline; part IDs remain available for grading.
  const entry=examples.outline.flatMap(group=>group.items).find(item=>item.question===question.id);
  assert.ok(entry.label);assert.equal(entry.parts,undefined);
  assert.deepEqual(Array.from(type.getOutlineItems(question.data)),[]);
  const result=type.grade(question.data,{responses:{}});
  const score=type.getScore(question.data,{submitted:true,result});
  assert.deepEqual(Array.from(score.outlineStates,item=>item.id),question.data.parts.map(part=>part.id));
  assert.ok(score.outlineStates.every(item=>item.status==='unanswered'));
});
