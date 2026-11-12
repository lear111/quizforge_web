import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SOLUTION_MARKER = 'V2_SOLUTION_MUST_STAY_PRIVATE_7cd94e';
export function writeFixtureFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
}
export function fixtureBank(count = 20) {
  const questions = {}, items = [];
  for (let i = 0; i < count; i++) {
    const id = String(i + 1);
    items.push(i === 1 ? { id, listening: 'local', parts: [{ id: 'p1', label: '2-1', maxScore: 0.1 }, { id: 'p2', label: '2-2', maxScore: 0.2 }] } : { id, label: String(i + 1), maxScore: 2, ...(i === 0 ? { listening: 'https' } : i === 2 ? { listening: 'http' } : {}) });
    questions[id] = {
      type: 'quizforge.synthetic-choice@2',
      question: { stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `合成题 ${id}` }] }, { type: 'image', attrs: { src: 'qf-asset:assets/figure.png' } }] }, answerArea: { height: 320, style: 'blank' }, options: ['甲', '乙'], parts: { p1: {}, p2: {} } },
      solution: { answer: '乙', explanation: SOLUTION_MARKER + '_' + id, image: 'qf-asset:assets/solution.txt' }
    };
  }
  questions.ignored = { type: null, question: 42, solution: SOLUTION_MARKER };
  return { formatVersion: 2, id: 'synthetic-bank', title: '合成题库', description: '仅用于自动化验证',
    features: { history: true, exam: true }, listening: { local: { title: '合成本地材料', src: 'assets/tone.wav' }, https: { title: '网络材料', src: 'https://audio.example.test/a.mp3' }, http: { title: 'HTTP 材料', src: 'http://audio.example.test/b.mp3' }, ignored: { src: 'invalid:' } },
    outline: [{ title: '第一组', items: items.slice(0, Math.ceil(count / 2)) }, { title: '第二组', items: items.slice(Math.ceil(count / 2)) }], questions };
}
export function addFixtureExtension(root, { name = 'choice', id = 'quizforge.synthetic-choice', version = '2.1.0', development = false } = {}) {
  const directory = path.join(root, 'extensions', 'synthetic', name);
  const manifest = { id, version, name: '合成单选题', apiVersion: 2, entries: { practice: { html: 'practice.html', js: 'practice.js', css: 'practice.css' }, grade: 'grade.js' }, sdkVersions: { richtext: '2.0.0', 'answer-area': '2.0.0' }, development };
  writeFixtureFile(path.join(directory, 'manifest.json'), manifest);
  writeFixtureFile(path.join(directory, 'practice.html'), '<!doctype html><html lang="zh-CN"><p>合成页面</p></html>');
  // If either author script is ever evaluated in Node the entire request must fail.
  for (const file of ['practice.js', 'grade.js']) writeFixtureFile(path.join(directory, file), 'throw new Error("AUTHOR_CODE_EXECUTED_IN_BACKEND");');
  writeFixtureFile(path.join(directory, 'practice.css'), 'body { color: #263238; }');
  return directory;
}
export function createReadFixture({ count = 20 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-read-')), codeRoot = path.join(root, 'core');
  const directory = path.join(root, 'question-banks', 'synthetic', 'bank'), bankFile = path.join(directory, 'bank.json'), bank = fixtureBank(count);
  writeFixtureFile(bankFile, bank);
  writeFixtureFile(path.join(directory, 'assets', 'figure.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64'));
  writeFixtureFile(path.join(directory, 'assets', 'solution.txt'), SOLUTION_MARKER);
  const wav = Buffer.alloc(2044); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  writeFixtureFile(path.join(directory, 'assets', 'tone.wav'), wav);
  const extension = addFixtureExtension(root);
  for (const component of ['richtext', 'answer-area']) writeFixtureFile(path.join(codeRoot, 'shared', component, '2.0.0', 'sdk.js'), `/* ${component} test fixture, not a browser implementation */`);
  return { root, codeRoot, directory, bankFile, bank, extension, cleanup() { fs.rmSync(root, { recursive: true, force: true }); } };
}
