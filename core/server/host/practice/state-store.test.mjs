import { copyFixture, writeFixture } from '../../../test/fixtures/installed-library.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StateStore, publicState, unsubmittedState } from './state-store.js';
import { Library } from '../library/library.js';
import { RuleEngine } from '../extensions/rule-engine.js';
import { cloneJson, jsonBytes } from '../platform/json.js';
import { readJson, safeDirectory, within } from '../platform/files.js';
import { validateRound } from '../history/history-rounds.js';
import { AiGradingService } from '../ai/ai-grading-service.js';
import { AiProviderError } from '../ai/ai-provider.js';

const codeRoot = fileURLToPath(new URL('../../../', import.meta.url)), temporaryRoot = path.join(path.dirname(codeRoot), '.temp', 'node-migration');
async function fixture(t, activeReports = false) {
  safeDirectory(temporaryRoot, true); const root = fs.mkdtempSync(path.join(temporaryRoot, 'state-'));
  fs.mkdirSync(path.join(root, 'extensions')); fs.mkdirSync(path.join(root, 'question-banks'));
  copyFixture(path.join(codeRoot, 'test', 'fixtures', 'legacy-extensions', 'single-choice-1.0.0'), path.join(root, 'extensions', 'Test', 'choice'), { recursive: true });
  if (activeReports) { const file=path.join(root,'extensions','Test','choice','manifest.json'),manifest=readJson(file);manifest.requiresApi={major:1,minMinor:3,capabilities:['outline-items','answer-state']};writeFixture(file,jsonBytes(manifest)); }
  const engine = await RuleEngine.create(codeRoot); engine.validationEnvironment = async () => 'fixture'; const library = new Library(root, codeRoot, engine), store = new StateStore(root, engine), collection = await library.collection('extension', 'quizforge.single-choice');
  t.after(() => { library.close(); engine.close(); assert.ok(within(temporaryRoot, root) && root !== temporaryRoot); fs.rmSync(root, { recursive: true, force: true }); }); return { root, library, engine, store, collection };
}
const action = (revision, name, data, requestId = 'request-' + Math.random().toString(36).slice(2)) => ({ requestId, revision, action: name, data });

test('history borrows only internally; current edits and caller mutations cannot change a frozen round', async t => {
  const {store, collection, engine} = await fixture(t), question = collection.questions[0];
  const ink = x => ({schemaVersion:1,viewport:{x:0,y:0,zoom:1},paper:{color:'#ffffff',pattern:'plain'},strokes:[{id:'test-ink',color:'#334455',width:2,points:[{x,y:1,pressure:0.5}]}]});
  const originalRun = engine.run.bind(engine);
  // Rules must receive independent states, not a reference into the persisted
  // graph (checking descendants as well as the immediate state container).
  engine.run = async (extension, input) => {
    const graph = new Set();
    const collect = v => {if(v && typeof v==='object' && !graph.has(v)){graph.add(v);for(const child of Object.values(v))collect(child);}};
    collect(store.load(collection));
    const independent = v => {if(v && typeof v==='object'){assert.equal(graph.has(v),false,'persisted object leaked to a rule state');for(const child of Object.values(v))independent(child);}};
    if(input.state)independent(input.state);
    for(const row of input.questions ?? [])if(row.state)independent(row.state);
    return originalRun(extension,input);
  };
  await store.act(collection,question,action(0,'whiteboard',{draft:ink(1)}));
  const submitted = await store.act(collection,question,action(1,'submit',{answer:{selectedOptionId:'A'}}));
  const before = store.load(collection), round = before.historyRounds.at(-1), roundBytes = jsonBytes(round);
  submitted.draft.strokes[0].points[0].x=500;submitted.state.answer.selectedOptionId='D';
  await store.act(collection,question,action(2,'whiteboard',{draft:ink(9)}));
  await store.act(collection,question,action(3,'retry',{}));
  await store.act(collection,question,action(4,'draft',{answer:{selectedOptionId:'B'}}));
  assert.ok(jsonBytes(round).equals(roundBytes));assert.equal(store.load(collection).historyRounds.at(-1),round);
  const publicRound=await store.history(collection.kind,collection.id,round.id);
  publicRound.questions[0].payload.draft.strokes[0].points[0].x=900;
  publicRound.questions[0].payload.state.answer.selectedOptionId='C';
  publicRound.collection.states[question.id].answer.selectedOptionId='D';
  assert.ok(jsonBytes(store.load(collection).historyRounds.at(-1)).equals(roundBytes));
  const state=store.load(collection).questions[question.id];
  const plain=publicState(state), unsubmitted=unsubmittedState(state);
  plain.answer.selectedOptionId='D';unsubmitted.draft.strokes[0].points[0].x=42;
  assert.equal(state.answer.selectedOptionId,'B');assert.equal(state.draft.strokes[0].points[0].x,9);
  const exported=await store.freezeRound(collection,store.load(collection),collection.questions.map(q=>store.load(collection).questions[q.id] ?? {status:'unanswered',revision:0,answer:null,result:null,draft:null,receipts:[]}));
  exported.questions[0].payload.draft.strokes[0].points[0].x=99;
  exported.questions[0].payload.state.answer.selectedOptionId='D';
  assert.equal(state.answer.selectedOptionId,'B');assert.equal(state.draft.strokes[0].points[0].x,9,'public freezeRound still returns independent snapshots');
  const summary=await store.summary(collection), finished=await store.finish(collection,{requestId:'finish-history-cow',roundId:summary.roundId,summaryVersion:summary.summaryVersion});
  const frozen=store.load(collection).historyRounds.at(-1), frozenBytes=jsonBytes(frozen);
  await store.act(collection,question,action(5,'whiteboard',{draft:ink(77)}));
  await store.act(collection,question,action(6,'draft',{answer:{selectedOptionId:'C'}}));
  assert.ok(jsonBytes(frozen).equals(frozenBytes));assert.equal(store.load(collection).historyRounds.at(-1),frozen);
  assert.notEqual(finished.historyId,null);
});

for(const memory of [false,true])test(`completion receipts own modified containers and preserve old graphs (${memory?'memory':'disk'})`,async t=>{
  const f=await fixture(t),{collection}=f,store=memory?StateStore.memory(f.root,f.engine):f.store,question=collection.questions[0];
  await store.act(collection,question,action(0,'draft',{answer:{selectedOptionId:'A'}}));
  const summary=await store.summary(collection), request={requestId:'complete-cow',roundId:summary.roundId,summaryVersion:summary.summaryVersion};
  let previous=store.load(collection), bytes=jsonBytes(previous);
  await store.submitSaved(collection,request);
  assert.ok(jsonBytes(previous).equals(bytes));assert.equal(store.load(collection).questions[question.id].status,'submitted');
  previous=store.load(collection);bytes=jsonBytes(previous);
  const response={saved:true,nested:{text:'stable'}};
  await store.saveCompletionResult(collection,request,response);
  assert.ok(jsonBytes(previous).equals(bytes));assert.equal(store.load(collection).questions,previous.questions);
  assert.notEqual(store.load(collection).completionReceipts,previous.completionReceipts);
  response.nested.text='caller modified';assert.equal((await store.completionResult(collection,request)).nested.text,'stable');
  const replay=await store.completionResult(collection,request);replay.nested.text='changed again';assert.equal((await store.completionResult(collection,request)).nested.text,'stable');
  const current=store.load(collection);await store.submitSaved(collection,request);assert.equal(store.load(collection),current,'replay does not persist');
  await store.saveCompletionResult(collection,{requestId:'missing'},{});assert.equal(store.load(collection),current);
});

test('a fused draft outline response is cached without spawning a second scoring operation',async t=>{
 const {store,collection,engine}=await fixture(t),question=collection.questions[0];question.outlineItems=[{id:'child',label:'1'}];
 const run=engine.run.bind(engine),operations=[];
 engine.run=async(extension,input)=>{
  operations.push(input.op);assert.notEqual(input.op,'scoreBatch','Draft response must reuse the fused score');
  const result=await run(extension,input);
  if(input.op==='validateAnswer'){
   assert.equal(input.outlineAfterValidation,true);assert.equal(input.outlineRevision,1);
   result.outlineScore={score:0,maxScore:1,gradingStatus:'unsubmitted',outlineStates:[{id:'child',status:'draft'}]};
  }
  return result;
 };
 const saved=await store.act(collection,question,action(0,'draft',{answer:{selectedOptionId:'A'}}));
 assert.deepEqual(saved.state.outlineStates,[{id:'child',status:'draft'}]);assert.equal(saved.state.result,null);assert.deepEqual(operations,['validateAnswer']);
});
test('active answer reports persist and reload without pre-submit scoring, and reject foreign IDs',async t=>{
 const {store,collection,engine,root}=await fixture(t,true),question=collection.questions[0];
 question.outlineItems=[{id:'a',label:'1'},{id:'b',label:'2'}];assert.equal(collection.extensionFor(question).answerStateDeclared,true);
 const run=engine.run.bind(engine),operations=[];
 engine.run=async(extension,input)=>{operations.push(input.op);if(input.op==='validateAnswer')assert.equal(input.outlineAfterValidation,false);return run(extension,input);};
 const first={status:'draft',outlineStates:[{id:'a',status:'draft'}]},cleared={status:'unanswered',outlineStates:[{id:'a',status:'unanswered'}]};
 const saved=await store.act(collection,question,action(0,'draft',{answer:{selectedOptionId:'A'},answerState:first}));
 assert.deepEqual(saved.state.answerState,first);assert.deepEqual(saved.state.outlineStates,first.outlineStates);assert.deepEqual(operations,['validateAnswer']);
 const reopened=new StateStore(root,engine);assert.deepEqual((await reopened.question(collection,question)).state,saved.state);assert.equal(operations.includes('scoreBatch'),false);
 await assert.rejects(store.act(collection,question,action(1,'draft',{answer:{selectedOptionId:'A'},answerState:{status:'draft',outlineStates:[{id:'foreign',status:'draft'}]}})),{code:'INVALID_ANSWER_STATE'});
 await store.act(collection,question,action(1,'draft',{answer:{selectedOptionId:'A'},answerState:cleared}));
 assert.deepEqual((await new StateStore(root,engine).question(collection,question)).state.answerState,cleared);
 const summary=await store.summary(collection),done=await store.finish(collection,{requestId:'finish-active-states',roundId:summary.roundId,summaryVersion:summary.summaryVersion});
 const frozen=await store.history(collection.kind,collection.id,done.historyId);validateRound(readJson(store.file(collection)).historyRounds[0]);assert.deepEqual(frozen.questions[0].payload.state.answerState,cleared);
 await store.restart(collection,{requestId:'restart-active-states',roundId:done.roundId,summaryVersion:done.summaryVersion});
 assert.equal((await store.question(collection,question)).state.answerState,undefined);assert.deepEqual(await store.history(collection.kind,collection.id,done.historyId),frozen);
});
test('editing question content clears reported progress while title-only edits preserve it',async t=>{
 const {root,store,library,collection}=await fixture(t,true),raw=readJson(collection.extension.examples);
 raw.id='active-state-edits';writeFixture(path.join(root,'question-banks', 'active-state-edits', 'bank.json'),jsonBytes(raw));
 let bank=await library.collection('bank',raw.id),question=bank.questions[0];const answerState={status:'draft',outlineStates:[]};
 await store.act(bank,question,action(0,'draft',{answer:{selectedOptionId:'A'},answerState}));
 const edit=async(title,data)=>{const editor=await store.editor(library,bank,question);return store.edit(library,bank,question,{requestId:'edit-state-'+Math.random().toString(36).slice(2),revision:editor.revision,contentVersion:editor.contentVersion,sourceVersion:editor.sourceVersion,title,data});};
 const renamed=await edit('renamed',question.data);assert.deepEqual(renamed.payload.state.answerState,answerState);
 bank=await library.collection('bank',raw.id);question=bank.questions[0];const data=cloneJson(question.data);data.stem+=' changed';
 const changed=await edit(question.title,data);assert.equal(changed.payload.state.status,'unanswered');assert.equal(changed.payload.state.answerState,undefined);
});
test('draft, submit and idempotent receipts retain old persistent file identity', async t => {
  const { store, collection, root, engine } = await fixture(t), question = collection.questions[0];
  const initial = await store.question(collection, question); assert.equal(initial.state.status, 'unanswered'); assert.equal(initial.question.data.correctOptionId, undefined);
  const saved = await store.act(collection, question, action(0, 'draft', { answer: { selectedOptionId: 'A' } })); assert.equal(saved.state.status, 'draft');
  const request = action(1, 'submit', { answer: { selectedOptionId: 'A' } }, 'submit-stable');
  const submitted = await store.act(collection, question, request); assert.equal(submitted.state.result.correct, true); assert.equal(submitted.state.revision, 2);
  assert.deepEqual(await store.act(collection, question, request), submitted);
  await assert.rejects(store.act(collection, question, { ...request, data: { answer: { selectedOptionId: 'B' } } }), { code: 'REQUEST_ID_REUSED' });
  const reopened = new StateStore(root, engine); assert.deepEqual((await reopened.question(collection, question)).state, submitted.state);
  const savedFile = readJson(store.file(collection)); validateRound(savedFile.historyRounds[0]);
});

test('Java v1 saved practice and history open unchanged, including after a native restart', async t => {
  const { root, library, engine, store } = await fixture(t), fixtures = path.join(codeRoot, 'test', 'fixtures', 'node-host');
  const raw = readJson(path.join(fixtures, 'java-bank-v1.json')); raw.extension = { path: 'extensions/Test/choice' }; writeFixture(path.join(root, 'question-banks', 'oracle-bank', 'bank.json'), jsonBytes(raw));
  const collection = await library.collection('bank', 'oracle-bank');
  const oldBytes = fs.readFileSync(path.join(fixtures, 'java-state-v1.json')); writeFixture(store.file(collection), oldBytes);
  const expected = readJson(path.join(fixtures, 'java-history-v1.json'));
  const summary = await store.summary(collection); assert.equal(summary.finished, true); assert.equal(summary.score, 1);
  assert.deepEqual(await store.history('bank', collection.id, expected.id), expected);
  assert.deepEqual(fs.readFileSync(store.file(collection)), oldBytes, 'Reading must not migrate or rewrite an old state file');
  const reopened = new StateStore(root, engine);
  assert.deepEqual(await reopened.history('bank', collection.id, expected.id), expected);
  await reopened.restart(collection, { requestId: 'restart-java-v1', roundId: summary.roundId, summaryVersion: (await reopened.summary(collection)).summaryVersion });
  assert.equal((await reopened.question(collection, collection.questions[0])).state.status, 'unanswered');
  assert.deepEqual(await reopened.history('bank', collection.id, expected.id), expected);
});
test('simultaneous draft writes cannot both consume the same revision', async t => {
  const { store, collection } = await fixture(t), question = collection.questions[0];
  const results = await Promise.allSettled(['A', 'B'].map(selectedOptionId => store.act(collection, question, action(0, 'draft', { answer: { selectedOptionId } }))));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(results.find(result => result.status === 'rejected').reason.code, 'REVISION_CONFLICT');
});
test('finish freezes drafts without scoring them; restart leaves the historical page unchanged', async t => {
  const { store, collection, root } = await fixture(t), [first, second] = collection.questions;
  await store.act(collection, first, action(0, 'submit', { answer: { selectedOptionId: 'A' } }));
  await store.act(collection, second, action(0, 'draft', { answer: { selectedOptionId: 'B' } }));
  const summary = await store.summary(collection); assert.equal(summary.submittedCount, 1); assert.equal(summary.score, 1);
  const request = { requestId: 'finish-stable', roundId: summary.roundId, summaryVersion: summary.summaryVersion };
  const finished = await store.finish(collection, request); assert.equal(finished.finished, true); assert.deepEqual(await store.finish(collection, request), finished);
  const frozen = await store.history(collection.kind, collection.id, finished.historyId); assert.equal(frozen.questions[1].payload.state.status, 'draft'); assert.ok(frozen.page.script.length);
  const state = readJson(store.file(collection)); validateRound(state.historyRounds[0]);
  await store.restart(collection, { requestId: 'restart-stable', roundId: finished.roundId, summaryVersion: finished.summaryVersion });
  assert.equal((await store.question(collection, first)).state.status, 'unanswered'); assert.deepEqual(await store.history(collection.kind, collection.id, finished.historyId), frozen);
  await store.deleteHistory(collection.kind, collection.id, finished.historyId); assert.equal((await store.history(collection.kind, collection.id)).records.length, 0);
});
test('changed question resets current state with a backup and preserves frozen history', async t => {
  const { store, collection } = await fixture(t), question = collection.questions[0]; await store.act(collection, question, action(0, 'submit', { answer: { selectedOptionId: 'A' } }));
  const oldBytes = fs.readFileSync(store.file(collection)); question.fingerprint = 'b'.repeat(64);
  assert.equal((await store.question(collection, question)).state.status,'unanswered'); assert.deepEqual(fs.readFileSync(store.file(collection)+'.before-content-edit.bak'), oldBytes); assert.equal((await store.history(collection.kind, collection.id)).records.length, 1);
});
test('temporary practice has no durable state or historical browsing', async t => {
  const { root, engine, collection } = await fixture(t); const memory = StateStore.memory(root, engine), question = collection.questions[0];
  await memory.act(collection, question, action(0, 'draft', { answer: { selectedOptionId: 'A' } })); assert.equal(fs.existsSync(memory.file(collection)), false);
  await assert.rejects(memory.history(collection.kind, collection.id), { code: 'HISTORY_DISABLED' });
});
test('grouped bank edits atomically update source and state without losing old history', async t => {
  const { root, store, engine, library } = await fixture(t), original = await library.collection('extension', 'quizforge.single-choice');
  const raw = readJson(original.extension.examples); raw.id = 'grouped-bank'; fs.mkdirSync(path.join(root, 'question-banks', 'Group', 'Bank'), { recursive: true }); writeFixture(path.join(root, 'question-banks', 'Group', 'Bank', 'bank.json'), jsonBytes(raw));
  const collection = await library.collection('bank', 'grouped-bank'), question = collection.questions[0]; await store.act(collection, question, action(0, 'submit', { answer: { selectedOptionId: 'A' } }));
  const frozen = (await store.history('bank', collection.id)).records[0]; const editor = await store.editor(library, collection, question), data = cloneJson(question.data); data.stem += ' changed';
  const edited = await store.edit(library, collection, question, { requestId: 'edit-grouped', revision: editor.revision, contentVersion: editor.contentVersion, sourceVersion: editor.sourceVersion, title: question.title, data }); assert.equal(edited.payload.state.status, 'unanswered');
  const updated = await library.collection('bank', 'grouped-bank'), reopened = new StateStore(root, engine); assert.equal((await reopened.question(updated, updated.questions[0])).state.status, 'unanswered'); assert.equal((await reopened.history('bank', collection.id, frozen.id)).questions[0].payload.state.result.correct, true);
});
function gradingFixture(engine, collection) {
  collection.questions = [collection.questions[0]]; const run = engine.run.bind(engine);
  const input = { protocolVersion: 1, question: [{ type: 'text', text: 'question' }], answer: [{ type: 'text', text: 'answer' }], referenceAnswer: [{ type: 'text', text: 'reference' }], maxScore: 2, scoreStep: .5 };
  engine.run = async (extension, request) => {
    if (request.op === 'capabilities') return { canAiGrade: true };
    if (request.op === 'submit') { const value = await run(extension, request); return { ...value, result: { gradingStatus: 'pending', score: null, correct: null, maxScore: 4 }, capabilities: { canAiGrade: true } }; }
    if (request.op === 'prepareAiGrading') return { gradingInput: request.automatic ? { targets: ['part-1', 'part-2'].map(targetId => ({ targetId, input })) } : input };
    if (request.op === 'review') {
      const partScores = { ...(request.state.result.partScores ?? {}), [request.review.targetId ?? 'whole']: request.review.score }, score = Object.values(partScores).reduce((sum, value) => sum + value, 0);
      return { result: { gradingStatus: Object.keys(partScores).length >= 2 ? 'graded' : 'pending', score: Object.keys(partScores).length >= 2 ? score : null, correct: Object.keys(partScores).length >= 2 ? score === 4 : null, maxScore: 4, partScores }, projected: (await run(extension, { op: 'project', data: request.data, state: { submitted: true, result: request.state.result } })).projected, capabilities: { canAiGrade: true } };
    }
    return run(extension, request);
  };
}
async function settle(service, collection, question, id) {
  const end = Date.now() + 5000; while (Date.now() < end) { const result = await service.get(collection, question, id); if (!['running', 'queued', 'succeeded'].includes(result.status)) return result; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('AI fixture did not settle');
}
test('automatic child grading keeps targets distinct and lets extension aggregate', async t => {
  const { root, store, collection, engine, library } = await fixture(t); gradingFixture(engine, collection); library.collection = async () => collection; const question = collection.questions[0];
  await store.act(collection, question, action(0, 'submit', { answer: { selectedOptionId: 'A' } }));
  const gateway = { freeze() { return this; }, async generate() { return { output: '{"score":2,"feedback":"ok"}', provider: 'fixture', model: 'fixture', usage: {} }; } }, service = new AiGradingService(root, store, library, gateway); t.after(() => service.close());
  const tasks = await service.startAutomatic(collection, question, { requestId: 'auto-children' }); assert.equal(tasks.length, 2); assert.notEqual(tasks[0].taskId, tasks[1].taskId);
  for (const task of tasks) assert.equal((await settle(service, collection, question, task.taskId)).status, 'confirmed');
  const result = (await store.question(collection, question)).state.result; assert.equal(result.score, 4); assert.deepEqual(Object.keys(result.aiAssessments).sort(), ['part-1', 'part-2']);
});
test('automatic AI failure preserves pending answer and allows an ordinary manual review', async t => {
  const { root, store, collection, engine, library } = await fixture(t); gradingFixture(engine, collection); library.collection = async () => collection; const question = collection.questions[0]; await store.act(collection, question, action(0, 'submit', { answer: { selectedOptionId: 'A' } }));
  const gateway = { freeze() { return this; }, async generate() { throw new AiProviderError('AI_AUTH'); } }, service = new AiGradingService(root, store, library, gateway); t.after(() => service.close());
  const task = await service.start(collection, question, { requestId: 'grade-failure', targetId: 'part-1' }); const failed = await settle(service, collection, question, task.taskId); assert.equal(failed.status, 'failed'); assert.equal(failed.error.code, 'AI_AUTH');
  const current = await store.question(collection, question); assert.equal(current.state.status, 'submitted'); assert.equal(current.state.result.gradingStatus, 'pending');
  const reviewed = await store.act(collection, question, action(current.state.revision, 'review', { review: { score: 1, targetId: 'part-1' } })); assert.equal(reviewed.state.result.partScores['part-1'], 1);
});

test('forced regrading reuses a live child task, preserves other targets and allows a new completed attempt',async t=>{
  const {root,store,collection,engine,library}=await fixture(t);gradingFixture(engine,collection);library.collection=async()=>collection;const question=collection.questions[0];
  await store.act(collection,question,action(0,'submit',{answer:{selectedOptionId:'A'}}));
  let release,calls=0;const response={output:'{"score":2,"feedback":"ok"}',provider:'fixture',model:'fixture',usage:{}};
  const gateway={freeze(){return this;},generate(){calls++;return calls===1?new Promise(resolve=>{release=()=>resolve(response);}):Promise.resolve(response);}};
  const service=new AiGradingService(root,store,library,gateway);t.after(()=>{release?.();service.close();});
  const first=await service.start(collection,question,{requestId:'first-child',targetId:'part-1'});
  for(let i=0;i<30&&!release;i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(release);
  const duplicate=await service.start(collection,question,{requestId:'forced-child',targetId:'part-1',force:true});assert.equal(duplicate.taskId,first.taskId);assert.equal(calls,1);
  const other=await service.start(collection,question,{requestId:'other-child',targetId:'part-2',force:true});assert.notEqual(other.taskId,first.taskId);
  release();assert.equal((await settle(service,collection,question,first.taskId)).status,'confirmed');assert.equal((await settle(service,collection,question,other.taskId)).status,'confirmed');
  const repeated=await service.start(collection,question,{requestId:'completed-child',targetId:'part-1',force:true});assert.notEqual(repeated.taskId,first.taskId);
  assert.equal((await settle(service,collection,question,repeated.taskId)).status,'confirmed');assert.equal(calls,3);
});
