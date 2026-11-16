// J diagnostics only: construct data under a freshly-created OS temporary root.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, jsonBytes, parseJson, freezeJson } from '../../server/host/platform/json.js';
import { validateState } from '../../server/v2/repositories/state-shape.repository.js';

const examples = fileURLToPath(
  new URL('../../../examples/v2/extensions/基础题型/', import.meta.url),
);
const types = ['单选题', '多选题', '判断题'];
export const scenarios = [
  { name: 'small-no-ink', answerUnits: 8, strokes: 0 },
  { name: 'small-with-ink', answerUnits: 8, strokes: 30 },
  { name: 'large-with-ink', answerUnits: 900, strokes: 180 },
];

export function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-archive-measure-'));
  return {
    root,
    cleanup() {
      const relative = path.relative(os.tmpdir(), root);
      if (relative.includes(path.sep) || !relative.startsWith('qf-v2-archive-measure-')) {
        throw new Error('Refusing to clean outside the dedicated temporary directory');
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, jsonBytes(value));
}

function receipts(index) {
  return Array.from({ length: index % 5 }, (_, n) => ({
    requestId: `synthetic-${index}-${n}-` + 'r'.repeat((index % 4) * 16),
    signature: hash(Buffer.from(`synthetic-request-${index}-${n}`)),
  }));
}

function questionState(index, answerUnits) {
  const kind = index % 4;
  const answer =
    kind === 0
      ? null
      : {
          selected: 'A',
          text: '解：按题意逐步计算，所得结论满足条件。'.repeat(answerUnits + (index % 8)),
          measurements: [index, 0.5, index / 8],
        };
  const result =
    kind === 0
      ? { score: 0, parts: null, message: null }
      : kind === 1
        ? null
        : kind === 2
          ? { score: 2, parts: { a: 1, b: 1 }, message: null }
          : { score: null, parts: null, message: '等待评分。'.repeat(1 + (index % 16)) };
  return {
    status: kind === 0 ? 'wrong' : kind === 2 ? { a: 'correct', b: 'correct' } : 'answered',
    answer,
    result,
    submissionId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    revision: 2 + (index % 10),
    receipts: receipts(index),
  };
}

function inkValue(index, count) {
  return {
    ink: {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      paper: { color: '#ffffff', pattern: 'plain' },
      strokes: Array.from({ length: count + (index % 10) }, (_, n) => ({
        id: `pen-${index}-${n}`,
        color: '#334155',
        width: 3,
        points: Array.from({ length: 12 }, (_, j) => ({
          x: 30 + (n % 20) * 24 + j * 2,
          y: 40 + Math.floor(n / 20) * 22 + (j % 3),
          pressure: 0.5,
        })),
      })),
    },
    inkRevision: 1 + (index % 10),
    receipts: receipts(index),
  };
}

function createBank(directory, extensionIds) {
  const questions = {},
    items = [];
  for (let index = 1; index <= 200; index++) {
    const id = String(index);
    questions[id] = {
      type: extensionIds[index % 3] + '@2',
      question: { stem: `合成题 ${id}：选择并说明理由。`, options: ['A', 'B'] },
      solution: { selected: 'A', explanation: `第 ${id} 题合成解析。` },
    };
    items.push({ id, label: id, maxScore: 2 });
  }
  write(path.join(directory, 'bank.json'), {
    formatVersion: 2,
    id: path.basename(directory),
    title: 'J 合成题库',
    outline: [{ title: '合成分组', items }],
    questions,
  });
}

export function createArchiveFixture(root, scenario) {
  const directory = path.join(root, scenario.name);
  const extensionRoot = path.join(directory, 'extensions');
  fs.mkdirSync(extensionRoot, { recursive: true });
  const extensionIds = types.map((name) => {
    fs.cpSync(path.join(examples, name), path.join(extensionRoot, name), { recursive: true });
    return JSON.parse(fs.readFileSync(path.join(extensionRoot, name, 'manifest.json'))).id;
  });
  createBank(directory, extensionIds);
  const state = {
    formatVersion: 2,
    contentFingerprint: 'a'.repeat(64),
    lastQuestionId: '200',
    completedAt: '2026-11-15T00:00:00.000Z',
    questions: Object.fromEntries(
      Array.from({ length: 200 }, (_, n) => [
        String(n + 1),
        questionState(n + 1, scenario.answerUnits),
      ]),
    ),
  };
  const loaded = parseJson(jsonBytes(state));
  validateState(loaded);
  freezeJson(loaded);
  write(path.join(directory, '.qf-v2/practice/state.json'), loaded);
  const inkRoot = path.join(directory, '.qf-v2/practice/ink');
  fs.mkdirSync(inkRoot, { recursive: true });
  if (scenario.strokes) {
    for (let index = 1; index <= 200; index += 2) {
      const file = path.join(
        inkRoot,
        state.contentFingerprint,
        hash(Buffer.from(String(index))) + '.json',
      );
      write(file, inkValue(index, scenario.strokes));
    }
  }
  return { directory, state: loaded, extensionRoot, inkRoot, name: scenario.name };
}

export function inventory(fixture) {
  const bytes = (files) => files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  const extensionFiles = filesUnder(fixture.extensionRoot);
  const inkFiles = filesUnder(fixture.inkRoot);
  return {
    questions: 200,
    unansweredBeforeFinish: 50,
    scored: 100,
    pendingGrading: 100,
    stateBytes: jsonBytes(fixture.state).length,
    bankBytes: fs.statSync(path.join(fixture.directory, 'bank.json')).size,
    extensionBytes: bytes(extensionFiles),
    extensionFiles: extensionFiles.length,
    inkBytes: bytes(inkFiles),
    inkFiles: inkFiles.length,
    answerBytes: jsonBytes(Object.values(fixture.state.questions).map((q) => q.answer)).length,
    resultBytes: jsonBytes(Object.values(fixture.state.questions).map((q) => q.result)).length,
    receiptBytes: jsonBytes(Object.values(fixture.state.questions).map((q) => q.receipts)).length,
  };
}

export function sourceHashes(fixture) {
  return Object.fromEntries(
    filesUnder(fixture.directory).map((file) => [
      path.relative(fixture.directory, file),
      hash(fs.readFileSync(file)),
    ]),
  );
}
