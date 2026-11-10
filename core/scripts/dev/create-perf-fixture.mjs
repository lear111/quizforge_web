import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { RuleEngine } from '../../server/host/extensions/rule-engine.js';
import { Library } from '../../server/host/library/library.js';
import { StateStore } from '../../server/host/practice/state-store.js';
import { jsonBytes, cloneJson } from '../../server/host/platform/json.js';
import { validateRound } from '../../server/host/history/history-rounds.js';

const codeRoot = fileURLToPath(new URL('../../', import.meta.url));
const choiceRoot = path.resolve(codeRoot, '../extensions/基础题型/单选题');
export const perfAnswer = index => index % 3 === 0 ? { selectedOptionId: 'A' } : { value: 'A' };
const document = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
export function perfDraft(points = 120) {
  return { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, paper: { color: '#ffffff', pattern: 'plain' },
    strokes: [{ id: 'synthetic-stroke', color: '#334455', width: 2, points: Array.from({ length: points }, (_, i) => ({ x: i % 800, y: Math.floor(i / 800) + i % 11, pressure: 0.5 })) }] };
}
const rules = `QF.defineType({
  validateQuestion: d => !!d && typeof d.stem === 'string' && typeof d.expected === 'string',
  validateAnswer: a => !!a && typeof a.value === 'string',
  project: (d,c) => ({stem:d.stem,maxScore:3,...(c.submitted?{expected:d.expected}: {})}),
  grade: (d,a) => ({score:a.value===d.expected?3:0,maxScore:3,correct:a.value===d.expected,feedback:'Synthetic feedback'}),
  getOutlineItems: d => d.parts || [],
  getScore: (d,s) => ({score:s.result?.score || 0,maxScore:3,outlineStates:(d.parts || []).map(p=>({id:p.id,status:s.submitted?(s.result.correct?'correct':'incorrect'):(s.status==='draft'?'draft':'unanswered')}))})
});`;
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : jsonBytes(data)); }

export async function createPerfFixture(destination) {
  const root = path.resolve(destination);
  // Never turn an existing application data directory into benchmark data.
  fs.mkdirSync(root);
  const questions = Array.from({ length: 200 }, (_, index) => {
    const type = index % 3, parts = type === 2 ? Array.from({ length: 3 }, (_, i) => ({ id: 'p' + i, label: String(i + 1) })) : [];
    return { id: 'q' + String(index + 1).padStart(3, '0'), title: 'Synthetic question ' + (index + 1), extension: { path: 'extensions/Perf/type' + type },
      data: type === 0 ? { formatVersion: 1, stem: document('Synthetic choice ' + (index + 1)),
        options: ['A', 'B', 'C', 'D'].map(id => ({ id, content: document('Synthetic option ' + id) })),
        correctOptionId: 'A', answerAndExplanation: document('Synthetic explanation: option A is correct.'), maxScore: 3 }
        : { stem: ['Synthetic choice', 'Synthetic short answer', 'Synthetic parts'][type], expected: 'A', ...(parts.length ? { parts } : {}) } };
  });
  for (let type = 0; type < 3; type++) {
    const directory = path.join(root, 'extensions/Perf/type' + type);
    const source = type === 0 ? JSON.parse(fs.readFileSync(path.join(choiceRoot, 'manifest.json'), 'utf8')) : {};
    write(path.join(directory, 'manifest.json'), { ...source, id: 'perf.type' + type, version: source.version ?? '1.0.0', name: 'Synthetic type ' + type,
      entry: 'practice.html', script: 'practice.js', style: 'practice.css', rules: 'rules.js', examples: 'examples.json', questionSchema: 'question.schema.json', answerSchema: 'answer.schema.json',
      requiresApi: source.requiresApi ?? { major: 1, minMinor: 1, capabilities: ['outline-items'] } });
    write(path.join(directory, 'practice.html'), '<div id="synthetic">Synthetic performance fixture</div>');
    write(path.join(directory, 'practice.js'), '/* Synthetic fixture; no interactive browser implementation. */');
    write(path.join(directory, 'practice.css'), '#synthetic { color: #334455; }');
    if (type === 0) {
      // Keep real validation and its manifest declarations, including rich text.
      // Missing/incompatible dependencies must fail generation, never fall back.
      for (const [field, target] of [['rules', 'rules.js'], ['questionSchema', 'question.schema.json'], ['answerSchema', 'answer.schema.json']]) {
        fs.copyFileSync(path.join(choiceRoot, source[field]), path.join(directory, target));
      }
    } else {
      write(path.join(directory, 'rules.js'), rules);
      write(path.join(directory, 'question.schema.json'), true);
      write(path.join(directory, 'answer.schema.json'), true);
    }
    write(path.join(directory, 'examples.json'), { id: 'examples', title: 'Synthetic examples', questions: [questions[type]] });
  }
  write(path.join(root, 'question-banks/Perf/bank/bank.json'), { id: 'perf-bank', title: 'Synthetic performance bank', questions });
  const engine = await RuleEngine.create(codeRoot), library = new Library(root, codeRoot, engine);
  try {
    const collection = await library.collection('bank', 'perf-bank'), store = new StateStore(root, engine), value = store.load(collection);
    for (const [index, question] of collection.questions.entries()) value.questions[question.id] = {
      status: 'draft', revision: 8, fingerprint: question.fingerprint, answer: perfAnswer(index), result: null,
      draft: perfDraft(index % 5 === 0 ? 720 : 40), receipts: []
    };
    for (let i = 0; i < 2; i++) {
      const round = await store.freezeRound(collection, value, collection.questions.map(q => value.questions[q.id]));
      round.status = 'interrupted'; round.interruptionReason = 'synthetic-baseline'; validateRound(round);
      (value.historyRounds ??= []).push(round);
    }
    const setReceipts = points => {
      const draft = perfDraft(points);
      for (const [index, question] of collection.questions.entries()) {
        if (index % 5 !== 0) continue;
        const answer = perfAnswer(index), state = value.questions[question.id];
        state.receipts = Array.from({ length: 8 }, (_, i) => {
          const action = i % 2 ? 'whiteboard' : 'draft', id = 'synthetic-' + question.id + '-receipt-' + i;
          return { id, request: { requestId: id, revision: i, action, data: action === 'whiteboard' ? { draft } : { answer } },
            response: { question: { id: question.id, title: question.title, data: question.data },
              state: { status: 'draft', revision: i + 1, answer, result: null }, draft } };
        });
      }
    };
    // Adjust meaningful old receipt ink uniformly across forty questions; live
    // ink and both frozen rounds remain large after B1 trims these receipts.
    let low = 1, high = 1000;
    setReceipts(low);
    if (jsonBytes(value).length >= 5_000_000) throw Error('Fixed ink/history exceed the 5 MB fixture budget; review dependencies');
    setReceipts(high);
    if (jsonBytes(value).length < 5_000_000) throw Error('Receipt ink cannot reach the fixture budget');
    while (low < high) { const middle = Math.floor((low + high) / 2); setReceipts(middle); if (jsonBytes(value).length < 5_000_000) low = middle + 1; else high = middle; }
    setReceipts(low); store.commit(collection, value);
    // Validate exactly the persisted form using a fresh store, including history.
    const reopened = new StateStore(root, engine); reopened.load(collection);
    const states = Object.values(value.questions), stateBytes = fs.statSync(store.file(collection)).size;
    // Mutually exclusive byte attribution: frozen ink/receipts belong to history,
    // receipt ink belongs to receipts; other owns all keys and JSON punctuation.
    const receipts = states.reduce((sum, state) => sum + jsonBytes(state.receipts).length, 0);
    const ink = states.reduce((sum, state) => sum + jsonBytes(state.draft).length, 0), history = jsonBytes(value.historyRounds).length;
    const result = { fixture: 'quizforge-perf-a1-v2', questions: 200, types: 3, receipts: 320, receiptQuestions: 40, historyRounds: 2,
      stateFile: path.relative(root, store.file(collection)).replaceAll('\\', '/'), stateBytes,
      breakdown: { receipts, ink, history, other: stateBytes - receipts - ink - history } };
    write(path.join(root, 'perf-fixture.json'), result); return cloneJson(result);
  } finally { library.close(); await engine.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw Error('Usage: node core/scripts/dev/create-perf-fixture.mjs <new-empty-directory>');
  console.log(JSON.stringify(await createPerfFixture(process.argv[2]), null, 2));
}
