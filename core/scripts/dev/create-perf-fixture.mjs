import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { RuleEngine } from '../../server/host/extensions/rule-engine.js';
import { Library } from '../../server/host/library/library.js';
import { StateStore } from '../../server/host/practice/state-store.js';
import { jsonBytes, cloneJson } from '../../server/host/platform/json.js';
import { validateRound } from '../../server/host/history/history-rounds.js';

const codeRoot = fileURLToPath(new URL('../../', import.meta.url));
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
      data: { stem: ['Synthetic choice', 'Synthetic short answer', 'Synthetic parts'][type], expected: 'A', ...(parts.length ? { parts } : {}) } };
  });
  for (let type = 0; type < 3; type++) {
    const directory = path.join(root, 'extensions/Perf/type' + type);
    write(path.join(directory, 'manifest.json'), { id: 'perf.type' + type, version: '1.0.0', name: 'Synthetic type ' + type,
      entry: 'practice.html', script: 'practice.js', style: 'practice.css', rules: 'rules.js', examples: 'examples.json', questionSchema: 'question.schema.json', answerSchema: 'answer.schema.json',
      requiresApi: { major: 1, minMinor: 1, capabilities: ['outline-items'] } });
    write(path.join(directory, 'practice.html'), '<div id="synthetic">Synthetic performance fixture</div>');
    write(path.join(directory, 'practice.js'), '/* Synthetic fixture; no interactive browser implementation. */');
    write(path.join(directory, 'practice.css'), '#synthetic { color: #334455; }');
    write(path.join(directory, 'rules.js'), rules);
    write(path.join(directory, 'question.schema.json'), true);
    write(path.join(directory, 'answer.schema.json'), true);
    write(path.join(directory, 'examples.json'), { id: 'examples', title: 'Synthetic examples', questions: [questions[type]] });
  }
  write(path.join(root, 'question-banks/Perf/bank/bank.json'), { id: 'perf-bank', title: 'Synthetic performance bank', questions });
  const engine = await RuleEngine.create(codeRoot), library = new Library(root, codeRoot, engine);
  try {
    const collection = await library.collection('bank', 'perf-bank'), store = new StateStore(root, engine), value = store.load(collection);
    for (const question of collection.questions) value.questions[question.id] = { status: 'draft', revision: 32, fingerprint: question.fingerprint, answer: { value: 'A' }, result: null, draft: perfDraft(), receipts: [] };
    for (let i = 0; i < 2; i++) {
      const round = await store.freezeRound(collection, value, collection.questions.map(q => value.questions[q.id]));
      round.status = 'interrupted'; round.interruptionReason = 'synthetic-baseline'; validateRound(round);
      (value.historyRounds ??= []).push(round);
    }
    const first = collection.questions[0], state = value.questions[first.id];
    const setReceipts = points => {
      const draft = perfDraft(points);
      state.receipts = Array.from({ length: 32 }, (_, i) => ({ id: 'synthetic-receipt-' + i,
        request: { requestId: 'synthetic-receipt-' + i, revision: i, action: 'whiteboard', data: { draft } },
        response: { question: { id: first.id, title: first.title, data: { stem: 'Synthetic' } }, state: { status: 'draft', revision: i + 1, answer: { value: 'A' }, result: null }, draft } }));
    };
    // Deterministic point count, rather than irrelevant padding/unknown fields.
    let low = 1, high = 10000;
    while (low < high) { const middle = Math.floor((low + high) / 2); setReceipts(middle); if (jsonBytes(value).length < 5_000_000) low = middle + 1; else high = middle; }
    setReceipts(low); store.commit(collection, value);
    // Validate exactly the persisted form using a fresh store, including history.
    const reopened = new StateStore(root, engine); reopened.load(collection);
    const result = { fixture: 'quizforge-perf-a1-v1', questions: 200, types: 3, receipts: 32, historyRounds: 2,
      stateFile: path.relative(root, store.file(collection)).replaceAll('\\', '/'), stateBytes: fs.statSync(store.file(collection)).size };
    write(path.join(root, 'perf-fixture.json'), result); return cloneJson(result);
  } finally { library.close(); await engine.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw Error('Usage: node core/scripts/dev/create-perf-fixture.mjs <new-empty-directory>');
  console.log(JSON.stringify(await createPerfFixture(process.argv[2]), null, 2));
}
