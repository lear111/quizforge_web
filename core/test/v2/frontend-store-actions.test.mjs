import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  stdin: {
    contents: `export {createPinia,disposePinia} from 'pinia';
      export {createRouter,createMemoryHistory} from 'vue-router';
      export {usePracticeStore} from './stores/practice';
      export {useCatalogStore} from './stores/catalog';
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
  createRouter,
  createMemoryHistory,
  usePracticeStore,
  useCatalogStore,
  useUiStore,
  workspaceRoutes,
  createWorkspaceNavigation,
} = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);

function fixture(t) {
  const pinia = createPinia();
  const practice = usePracticeStore(pinia),
    ui = useUiStore(pinia),
    catalog = useCatalogStore(pinia);
  const router = createRouter({ history: createMemoryHistory(), routes: workspaceRoutes({}) });
  const navigation = createWorkspaceNavigation(router, practice, ui);
  t.after(() => {
    navigation.dispose();
    disposePinia(pinia);
  });
  return { practice, ui, catalog, router, navigation };
}
const groups = (id) => ({
  groups: [
    { id, name: 'Synthetic group', items: [{ bankId: id + '-bank', title: 'Synthetic bank' }] },
  ],
});

test('Pinia publishes only view and Router actions, keeping session helpers private', (t) => {
  const { practice } = fixture(t);
  for (const name of [
    'catalog',
    'openBank',
    'navigate',
    'refreshBank',
    'flush',
    'retrySave',
    'continueGrading',
    'complete',
    'resumeCompletion',
    'clearQuestion',
    'resetSources',
    'pageFaulted',
    'attachView',
    'detachView',
    'toggleDraft',
  ]) {
    assert.equal(typeof practice[name], 'function', name);
  }
  for (const name of [
    'update',
    'context',
    'applyCompletion',
    'pictures',
    'disposePage',
    'applyContext',
    'show',
    'scopeSources',
    'createSaver',
    'reloadAfterConflict',
    'score',
    'grade',
    'submit',
    'retry',
    'recoverPending',
    'reloadCompletedQuestion',
    'gradeCompleted',
    'initializeRuntime',
    'remember',
    'initializeCatalog',
  ]) {
    assert.equal(Object.hasOwn(practice, name), false, name);
  }
});

test('startup reads catalog once, preserves blank startup and reuses its API after token changes', async (t) => {
  const f = fixture(t),
    requests = [],
    dependencies = [];
  f.catalog.$onAction(({ name, args }) => {
    if (name === 'read') {
      dependencies.push(args[0]);
    }
  });
  t.mock.method(globalThis, 'fetch', async (route, options) => {
    requests.push({ route, options });
    assert.equal(f.ui.busy, true);
    assert.equal(f.ui.loading, '正在读取题库');
    return Response.json(groups(String(requests.length)));
  });
  await f.router.push('/');
  await f.navigation.start();
  await f.navigation.start();
  assert.equal(requests.length, 1);
  assert.equal(f.practice.current, null);
  assert.equal(f.practice.overview, null);
  assert.equal(f.router.currentRoute.value.name, 'library');
  f.catalog.toggleGroup('1');
  f.ui.token = 'synthetic-token';
  await f.navigation.catalog();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers['x-quizforge-token'], undefined);
  assert.equal(requests[1].options.headers['x-quizforge-token'], 'synthetic-token');
  for (const { route, options } of requests) {
    assert.equal(route, '/api/v2/catalog');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
  }
  assert.equal(dependencies[0], dependencies[1]);
  assert.deepEqual(Object.keys(dependencies[0]), ['get']);
  assert.equal(f.catalog.groups[0].path, '2');
  assert.equal(f.catalog.groups[0].expanded, false);
  assert.equal(f.ui.busy, false);
  assert.equal(f.ui.loading, '');
});

test('catalog failure keeps the previous list; authentication retries keep the same API dependency', async (t) => {
  const f = fixture(t),
    dependencies = [];
  let status = 200;
  f.catalog.$onAction(({ name, args }) => {
    if (name === 'read') {
      dependencies.push(args[0]);
    }
  });
  t.mock.method(globalThis, 'fetch', async () => {
    if (status === 0) {
      throw Error('synthetic network failure');
    }
    return status === 200
      ? Response.json(groups('kept'))
      : Response.json(
          { error: { code: 'AUTH_REQUIRED', message: 'synthetic login required' } },
          { status },
        );
  });
  await f.practice.catalog();
  const previous = f.catalog.groups;
  status = 401;
  await f.practice.catalog();
  assert.equal(f.ui.authRequired, true);
  assert.equal(f.ui.message, 'synthetic login required');
  assert.equal(f.catalog.groups, previous);
  assert.equal(f.ui.busy, false);
  status = 0;
  await f.practice.catalog();
  assert.equal(f.ui.message, 'synthetic network failure');
  assert.equal(f.ui.authRequired, true);
  assert.equal(f.catalog.groups, previous);
  status = 200;
  f.ui.token = 'synthetic-replacement';
  await f.practice.catalog();
  assert.equal(f.ui.authRequired, false);
  assert.equal(f.ui.message, '');
  assert.ok(dependencies.every((dependency) => dependency === dependencies[0]));
  assert.equal(f.ui.loading, '');
});

test('separate Pinia instances keep separate catalog transports and current credentials', async (t) => {
  const a = fixture(t),
    b = fixture(t),
    dependencies = [],
    tokens = [];
  a.catalog.$onAction(({ args }) => dependencies.push(args[0]));
  b.catalog.$onAction(({ args }) => dependencies.push(args[0]));
  t.mock.method(globalThis, 'fetch', async (_route, options) => {
    const token = options.headers['x-quizforge-token'];
    tokens.push(token);
    return Response.json(groups(token));
  });
  a.ui.token = 'a';
  b.ui.token = 'b';
  await a.practice.catalog();
  await b.practice.catalog();
  a.ui.token = 'a-new';
  await a.practice.catalog();
  assert.deepEqual(tokens, ['a', 'b', 'a-new']);
  assert.equal(dependencies[0], dependencies[2]);
  assert.notEqual(dependencies[0], dependencies[1]);
  assert.equal(a.catalog.groups[0].path, 'a-new');
  assert.equal(b.catalog.groups[0].path, 'b');
});

test('a busy catalog read is not duplicated and clears authentication only after success', async (t) => {
  const f = fixture(t),
    requests = [];
  let respond;
  const response = new Promise((resolve) => {
    respond = resolve;
  });
  t.mock.method(globalThis, 'fetch', (route) => {
    requests.push(route);
    return response;
  });
  f.ui.authRequired = true;
  const pending = f.practice.catalog();
  assert.equal(f.ui.busy, true);
  assert.equal(f.ui.authRequired, true);
  await f.practice.catalog();
  assert.deepEqual(requests, ['/api/v2/catalog']);
  assert.equal(f.ui.busy, true);
  assert.equal(f.ui.authRequired, true);
  assert.deepEqual(f.catalog.groups, []);
  respond(Response.json(groups('ready')));
  await pending;
  assert.equal(f.catalog.groups[0].path, 'ready');
  assert.equal(f.ui.authRequired, false);
  assert.equal(f.ui.busy, false);
});

test('openBank keeps absent-id no-op and uses the bank id without a dummy kind argument', async (t) => {
  const f = fixture(t),
    requests = [];
  t.mock.method(globalThis, 'fetch', async (route, options) => {
    requests.push({ route, options });
    return Response.json({
      bank: { bankId: 'synthetic-bank', title: 'Synthetic' },
      snapshotId: 's1',
      outline: [],
      states: [],
      completedAt: null,
      pendingGrading: [],
      initial: { question: null, error: null },
      total: { score: 0, maxScore: 0 },
    });
  });
  await f.practice.openBank();
  assert.deepEqual(requests, []);
  await f.practice.openBank('synthetic-bank');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].route, '/api/v2/banks/synthetic-bank/overview');
  assert.equal(f.practice.overview.bank.bankId, 'synthetic-bank');
  assert.equal(f.ui.message, '题库没有题目。');
  assert.equal(f.ui.busy, false);
});
