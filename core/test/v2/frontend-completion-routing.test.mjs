import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  stdin: {
    contents: `export {createPinia,disposePinia} from 'pinia';
      export {nextTick} from 'vue';
      export {createRouter,createMemoryHistory,isNavigationFailure} from 'vue-router';
      export {usePracticeStore} from './stores/practice';
      export {useUiStore} from './stores/ui';
      export {workspaceRoutes} from './router/routes';
      export {createWorkspaceNavigation} from './router/navigation';`,
    resolveDir: fileURLToPath(new URL('../../frontend/src/v2', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"test"' },
});
const {
  createPinia,
  disposePinia,
  nextTick,
  createRouter,
  createMemoryHistory,
  isNavigationFailure,
  usePracticeStore,
  useUiStore,
  workspaceRoutes,
  createWorkspaceNavigation,
} = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);

function overview(completedAt = null) {
  const question = {
    bankId: 'a',
    questionId: '1',
    snapshotId: 's1',
    question: {},
    answer: null,
    solution: null,
    result: null,
    ink: null,
    inkRevision: 0,
    submissionId: null,
    extension: { artifactId: 'single' },
    resources: [],
    item: { questionId: '1', label: '1', maxScore: 2, children: [] },
    state: {
      questionId: '1',
      revision: 0,
      status: 'unanswered',
      locked: false,
      hasSavedAnswer: false,
    },
  };
  return {
    bank: { bankId: 'a', title: 'Synthetic' },
    snapshotId: 's1',
    completedAt,
    outline: [{ title: '', items: [question.item] }],
    states: [question.state],
    initial: { question, error: null },
    pendingGrading: [],
    total: { score: 0, maxScore: 2 },
  };
}
async function fixture(t, summary = false) {
  const pinia = createPinia(),
    practice = usePracticeStore(pinia),
    ui = useUiStore(pinia);
  const router = createRouter({ history: createMemoryHistory(), routes: workspaceRoutes({}) });
  const navigation = createWorkspaceNavigation(router, practice, ui);
  const requests = [],
    controls = {};
  t.mock.method(globalThis, 'fetch', async (route) => {
    requests.push(route);
    if (route === '/api/v2/catalog') {
      return Response.json({ groups: [] });
    }
    if (route === '/api/v2/banks/a/refresh') {
      controls.dispatched.resolve();
      return controls.response;
    }
    throw Error('Unexpected request: ' + route);
  });
  t.after(() => {
    navigation.dispose();
    disposePinia(pinia);
  });
  practice.overview = overview(summary ? 'completed-before' : null);
  practice.current = practice.overview.initial.question;
  await nextTick();
  ui.scoreView = summary;
  await router.push(summary ? '/banks/a/summary' : '/banks/a/questions/1');
  await navigation.start();
  requests.length = 0;
  return { practice, ui, router, navigation, requests, controls };
}

test('a completion update does not silently replace the question view without navigating', async (t) => {
  const f = await fixture(t);
  // Same reactive write as applyCompletion/overview responses; use the actual
  // Pinia store, including any watchers, rather than the action-only fixture.
  f.practice.overview.completedAt = 'confirmed-server-completion';
  await nextTick();
  assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/questions/1');
  assert.equal(f.ui.scoreView, false);
  await f.navigation.showSummary();
  assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/summary');
  assert.equal(f.ui.scoreView, true);
  await f.navigation.showQuestion();
  assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/questions/1');
  assert.equal(f.ui.scoreView, false);
  assert.deepEqual(f.requests, []);
});

test('a cleared completion stays on its summary until the explicit return to questions', async (t) => {
  const f = await fixture(t, true);
  f.practice.overview.completedAt = null;
  await nextTick();
  assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/summary');
  assert.equal(f.ui.scoreView, true);
  await f.navigation.showQuestion();
  assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/questions/1');
  assert.equal(f.ui.scoreView, false);
  assert.deepEqual(f.requests, []);
});

async function history(router, delta) {
  const finished = new Promise((resolve) => {
    const stop = router.afterEach(() => {
      stop();
      resolve();
    });
  });
  router.go(delta);
  await finished;
}

test('completed questions and summary keep their explicit views through back and forward', async (t) => {
  const f = await fixture(t);
  f.practice.overview.completedAt = 'completed';
  await nextTick();
  await f.navigation.showSummary();
  await f.navigation.showQuestion();
  for (const [delta, name] of [
    [-1, 'summary'],
    [-1, 'practice'],
    [1, 'summary'],
    [1, 'practice'],
  ]) {
    await history(f.router, delta);
    assert.equal(f.router.currentRoute.value.name, name);
    assert.equal(f.ui.scoreView, name === 'summary');
    assert.equal(f.practice.current.questionId, '1');
    assert.equal(f.practice.overview.completedAt, 'completed');
  }
  assert.deepEqual(f.requests, []);
});

for (const completedAt of ['externally-completed', null]) {
  test(`refresh synchronizes ${completedAt ? 'completed summary' : 'active question'} despite a competing address change`, async (t) => {
    const f = await fixture(t, !completedAt);
    const response = Promise.withResolvers();
    f.controls.response = response.promise;
    f.controls.dispatched = Promise.withResolvers();
    const refresh = f.practice.refreshBank();
    await f.controls.dispatched.promise;
    const original = f.router.currentRoute.value.fullPath;
    const rejected = await f.router.push('/banks/a/questions/2');
    assert.ok(isNavigationFailure(rejected));
    assert.equal(f.router.currentRoute.value.fullPath, original);
    const value = overview(completedAt);
    // No DOM renderer is mounted in this store-level test.
    value.initial.question = null;
    response.resolve(Response.json(value));
    await refresh;
    await f.navigation.showCurrent();
    assert.equal(f.ui.scoreView, !!completedAt);
    assert.equal(f.router.currentRoute.value.name, completedAt ? 'summary' : 'practice');
    assert.equal(f.practice.overview.completedAt, completedAt);
    assert.equal(f.ui.busy, false);
    assert.deepEqual(f.requests, ['/api/v2/banks/a/refresh']);
  });
}

test('history question and summary routes stay scoped through back, forward and return', async (t) => {
  const f = await fixture(t);
  const original = f.practice.overview;
  const question = f.practice.current;
  const roundId = '11111111-1111-4111-8111-111111111111';
  // Routing is under test here; actual read/restore and iframe guards have
  // separate store and real-browser coverage.
  t.mock.method(f.practice, 'openHistory', async () => {
    f.practice.overview = { ...original, roundId, readOnly: true };
    f.practice.current = { ...question, roundId, readOnly: true };
    f.ui.scoreView = false;
  });
  t.mock.method(f.practice, 'leaveHistory', async () => {
    f.practice.overview = original;
    f.practice.current = question;
    f.ui.scoreView = false;
  });
  t.mock.method(f.practice, 'navigate', async (id) => {
    assert.equal(id, '1');
    f.ui.scoreView = false;
  });
  await f.navigation.openHistory(roundId);
  assert.equal(f.router.currentRoute.value.fullPath, `/banks/a/rounds/${roundId}/questions/1`);
  await f.navigation.showSummary();
  assert.equal(f.router.currentRoute.value.name, 'history-summary');
  await f.navigation.showQuestion();
  for (const [delta, name] of [
    [-1, 'history-summary'],
    [1, 'history'],
  ]) {
    await history(f.router, delta);
    assert.equal(f.router.currentRoute.value.name, name);
    assert.equal(f.ui.scoreView, name === 'history-summary');
    assert.equal(f.practice.overview.roundId, roundId);
  }
  await f.navigation.returnToPractice();
  assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/questions/1');
  assert.equal(f.practice.overview, original);
  assert.equal(f.practice.current, question);
  assert.deepEqual(f.requests, []);
});

test('failed history read or unsaved-answer flush preserves the active view and address', async (t) => {
  const f = await fixture(t);
  const original = f.practice.current;
  const open = t.mock.method(f.practice, 'openHistory', async () => {
    f.ui.message = '合成历史文件损坏';
  });
  await f.router.push('/banks/a/rounds/missing/summary');
  assert.equal(f.ui.scoreView, false);
  assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/questions/1');
  assert.equal(f.practice.current, original);
  assert.equal(open.mock.callCount(), 1);
  t.mock.method(f.practice, 'flush', async () => {
    throw Error('合成保存失败');
  });
  await f.navigation.openHistory('another');
  assert.equal(open.mock.callCount(), 1);
  assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/questions/1');
  assert.equal(f.practice.current, original);
  assert.match(f.ui.message, /合成保存失败/);
});
