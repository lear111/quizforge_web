import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize} from './history-rounds.js';
import {cloneJson,freezeJson,jsonBytes,parseJson} from '../platform/json.js';

test('summarize shares one calculation while public snapshots remain independent',()=>{
  for(const explicit of [false,true])for(const pending of [false,true]){
    const state=freezeJson(parseJson(`{"status":"submitted","revision":1,"answer":{"value":"A"},"result":{"score":${pending?'null':'2.5'},"maxScore":3.0,"correct":${pending?'null':'false'},"gradingStatus":"${pending?'pending':'graded'}"}}`));
    const round={questions:[{payload:{question:{id:'q1'},state}}],collection:{states:{}},status:'in-progress',explicitCompletion:explicit};
    const independent=summarize(cloneJson(round));
    const borrowed=summarize({...round,collection:{states:{}}},{borrowState:true});
    assert.ok(jsonBytes(independent).equals(jsonBytes(borrowed)));
    assert.equal(borrowed.collection.states.q1,state);
    assert.notEqual(independent.collection.states.q1,independent.questions[0].payload.state);
    independent.collection.states.q1.answer.value='caller changed';
    assert.equal(independent.questions[0].payload.state.answer.value,'A');assert.equal(state.answer.value,'A');
    assert.equal(borrowed.status,!explicit&&!pending?'completed':'in-progress');
  }
});
