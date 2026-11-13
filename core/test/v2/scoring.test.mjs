import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { validateResult } from '../../server/host/v2/state.js';
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../../frontend/src/v2/scoring.ts', import.meta.url))], bundle: true, write: false, format: 'esm' });
const { saveGrade, recoverGrades } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('out-of-range grading is stored as ungradable; connection and version failures remain pending without masking errors', async () => {
  const input = { questionId: 'q1' }, writes = [];
  const output = await saveGrade(input, async () => [{ questionId: 'q1', result: { score: 3, parts: null, message: null } }], async result => {
    writes.push(result); validateResult({ maxScore: 2 }, result); return result;
  });
  assert.equal(writes.length, 2); assert.match(output.message, /无效/); assert.equal(output.score, null);
  for (const code of ['RESULT_CONFLICT', 'SUBMISSION_STALE', 'STATE_WRITE_FAILED', undefined]) {
    let calls = 0;
    const error = Object.assign(new Error('synthetic failure'), { code });
    await assert.rejects(saveGrade(input, async () => [{ questionId: 'q1', result: {} }], async () => { calls++; throw error; }), e => e === error);
    assert.equal(calls, 1);
  }
});

test('pending recovery isolates a failed first/current question and a failed later question, grading all remaining questions', async () => {
  const scored = [], saved = [], failures = [];
  await recoverGrades(['current', 'bad', 'healthy', 'another'], async id => {
    scored.push(id); if (['current', 'bad'].includes(id)) throw Error(id); return id;
  }, async id => { saved.push(id); }, error => failures.push(error.message));
  assert.deepEqual(scored, ['current', 'bad', 'healthy', 'another']);
  assert.deepEqual(saved, ['healthy', 'another']); assert.deepEqual(failures, ['current', 'bad']);
});
