import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({
  stdin: {
    contents: `export {createPinia,disposePinia,storeToRefs} from 'pinia';
      export {reactive,ref,watch,nextTick} from 'vue';
      export {createRouter,createMemoryHistory,isNavigationFailure} from 'vue-router';
      export {workspaceRoutes} from './router/routes';
      export {createWorkspaceNavigation} from './router/navigation';
      export {useUiStore} from './stores/ui';
      export {useCatalogStore} from './stores/catalog';
      export {createRuntime} from './stores/runtime';
      export {createActions} from './stores/actions';`,
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
  storeToRefs,
  reactive,
  ref,
  watch,
  nextTick,
  createRouter,
  createMemoryHistory,
  isNavigationFailure,
  workspaceRoutes,
  createWorkspaceNavigation,
  useUiStore,
  useCatalogStore,
  createRuntime,
  createActions,
} = await import(
  'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
);

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function until(condition) {
  if (condition()) {
    return;
  }
  await new Promise((resolve) => {
    const stop = watch(condition, (value) => {
      if (value) {
        stop();
        resolve();
      }
    });
  });
}
const question = (bankId, questionId) => ({
  bankId,
  questionId,
  snapshotId: 'snapshot',
  answer: null,
  solution: null,
  result: null,
  ink: null,
  inkRevision: 0,
  submissionId: null,
  question: {},
  resources: [],
  extension: { artifactId: 'single' },
  item: { questionId, label: questionId, maxScore: 2, children: [] },
  state: { questionId, revision: 0, status: 'unanswered', locked: false, hasSavedAnswer: false },
});
function fixture(t) {
  const pinia = createPinia(),
    ui = useUiStore(pinia),
    catalog = useCatalogStore(pinia);
  const requests = [],
    banks = new Map(),
    controls = { catalogError: false };
  const api = {
    catalog: {
      get: async () => {
        if (controls.catalogError) {
          ui.authRequired = true;
          throw Error('请填写连接令牌。');
        }
        return {
          groups: [
            {
              id: 'group',
              name: 'Group',
              items: ['a', 'b'].map((bankId) => ({ bankId, title: bankId })),
            },
          ],
        };
      },
    },
    banks: {
      overview: async (bankId) => {
        requests.push('overview:' + bankId);
        if (!['a', 'b'].includes(bankId)) {
          throw Error('题库不存在。');
        }
        const questions = ['1', '2', '3'].map((id) => question(bankId, id));
        return {
          bank: { bankId, title: bankId },
          snapshotId: 'snapshot',
          outline: [{ title: '', items: questions.map((q) => q.item) }],
          states: questions.map((q) => q.state),
          initial: { question: questions[0], error: null },
          completedAt: banks.get(bankId) ?? null,
          pendingGrading: [],
          total: { score: 0, maxScore: 6 },
        };
      },
    },
    questions: {
      get: async ({ bankId, questionId }) => {
        requests.push('get:' + bankId + ':' + questionId);
        if (!['1', '2', '3'].includes(questionId)) {
          throw Error('题目不存在。');
        }
        return question(bankId, questionId);
      },
      prepareAnswer: () => ({ route: '/save', body: 'same request bytes' }),
      sendSave: async () => {
        requests.push('save');
        controls.sent.resolve();
        return controls.save.promise;
      },
    },
  };
  const ctx = {
    ...storeToRefs(ui),
    overview: ref(null),
    current: ref(null),
    typeName: ref('题目'),
    saveStatus: ref(''),
    recovering: ref(false),
    drafting: ref(false),
    lastQuestions: ref(new Map()),
    api,
    catalogStore: catalog,
    runtime: createRuntime(),
    run: ui.run,
  };
  let actions;
  ctx.actions = () => actions;
  actions = createActions(ctx);
  // Rendering/grading are covered by the real-browser probes. Keep actual
  // bank selection, save-controller, write-queue and navigation functions here.
  actions.show = async (q) => {
    actions.update(q);
    actions.remember(q);
    if (controls.loading) {
      controls.loading.started.resolve();
      await controls.loading.finish.promise;
    }
  };
  ctx.runtime.sources = { scope() {}, dispose() {} };
  ctx.runtime.completionGrader = { run: async () => null, clear() {} };
  const practice = reactive({ ...ctx, ...actions });
  const router = createRouter({ history: createMemoryHistory(), routes: workspaceRoutes({}) });
  const navigation = createWorkspaceNavigation(router, practice, ui);
  t.after(() => {
    navigation.dispose();
    ctx.runtime.saver?.destroy();
    disposePinia(pinia);
  });
  async function open(path = '/') {
    await router.push(path);
    await navigation.start();
    if (practice.current) {
      await until(
        () =>
          router.currentRoute.value.name === 'practice' ||
          router.currentRoute.value.name === 'summary',
      );
    }
  }
  function dirty() {
    controls.sent = deferred();
    controls.save = deferred();
    const previousWindow = globalThis.window;
    globalThis.window = { setTimeout: () => 1, clearTimeout() {} };
    t.after(() => {
      globalThis.window = previousWindow;
    });
    ctx.runtime.saver = actions.createSaver(practice.current, 0, {
      answer: async () => 'B',
      can: { retry: true },
      frame: {},
      update: async () => {},
    });
    ctx.runtime.answerVersion = 1;
    ctx.runtime.saver.changed('text');
  }
  return { ctx, practice, ui, router, navigation, requests, controls, banks, open, dirty };
}
const options = { timeout: 10000 };

test(
  'route refresh opens the exact question and bank-only routes preserve runtime return position',
  options,
  async (t) => {
    const f = fixture(t);
    await f.open('/banks/a/questions/2');
    assert.equal(f.practice.current.questionId, '2');
    assert.deepEqual(f.requests, ['overview:a', 'get:a:2']);
    await f.navigation.openBank('bank', 'b');
    await until(() => f.router.currentRoute.value.fullPath === '/banks/b/questions/1');
    await f.navigation.openBank('bank', 'a');
    await until(() => f.router.currentRoute.value.fullPath === '/banks/a/questions/2');
    assert.equal(f.practice.current.questionId, '2');
  },
);

test(
  'route guard waits for a real save before changing URL or loading the next question',
  options,
  async (t) => {
    const f = fixture(t);
    await f.open('/banks/a/questions/1');
    f.dirty();
    const navigation = f.navigation.navigate('2');
    await f.controls.sent.promise;
    assert.equal(f.ui.busy, true, 'the old pane must be inert while the guard waits for saving');
    assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/questions/1');
    assert.equal(f.practice.current.questionId, '1');
    assert.equal(f.requests.includes('get:a:2'), false);
    f.controls.save.resolve({ ...question('a', '1'), answer: 'B' });
    await navigation;
    await until(() => f.practice.current.questionId === '2');
    assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/questions/2');
    assert.deepEqual(f.requests.slice(-2), ['save', 'get:a:2']);
  },
);

test(
  'save failure blocks direct router navigation and preserves the pending draft and address',
  options,
  async (t) => {
    const f = fixture(t);
    await f.open('/banks/a/questions/1');
    f.dirty();
    const navigation = f.router.push('/banks/a/questions/2');
    await f.controls.sent.promise;
    f.controls.save.reject(Error('network unavailable'));
    assert.equal(isNavigationFailure(await navigation), true);
    assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/questions/1');
    assert.equal(f.practice.current.questionId, '1');
    assert.equal(f.ctx.runtime.saver.dirty, true);
    assert.equal(f.requests.includes('get:a:2'), false);
    assert.equal(f.ui.message, 'network unavailable');
  },
);

test(
  'failed question loading restores the old address without dropping its input',
  options,
  async (t) => {
    const f = fixture(t);
    await f.open('/banks/a/questions/1');
    f.practice.current.answer = 'kept';
    await f.navigation.navigate('missing');
    await until(() => f.router.currentRoute.value.fullPath === '/banks/a/questions/1');
    assert.equal(f.practice.current.answer, 'kept');
    assert.equal(f.ui.message, '题目不存在。');
  },
);

test(
  'rapid navigation waits for the first pending save and does not load a third question',
  options,
  async (t) => {
    const f = fixture(t);
    await f.open('/banks/a/questions/1');
    f.dirty();
    const first = f.navigation.navigate('2');
    await f.controls.sent.promise;
    await f.navigation.navigate('3');
    assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/questions/1');
    f.controls.save.resolve({ ...question('a', '1'), answer: 'B' });
    await first;
    await until(() => f.practice.current.questionId === '2');
    assert.equal(f.requests.includes('get:a:3'), false);
  },
);

test(
  'current healthy route is a no-op but clicking a faulted current question reloads it',
  options,
  async (t) => {
    const f = fixture(t);
    await f.open('/banks/a/questions/1');
    const before = f.requests.length;
    await f.navigation.navigate('1');
    assert.equal(f.requests.length, before);
    f.ctx.runtime.page = { faulted: true };
    await f.navigation.navigate('1');
    await until(() => !f.ui.busy);
    assert.deepEqual(f.requests.slice(before), ['get:a:1']);
  },
);

test('named routes encode identifiers without treating them as page delimiters', () => {
  const router = createRouter({ history: createMemoryHistory(), routes: workspaceRoutes({}) });
  const route = router.resolve({
    name: 'practice',
    params: { bankId: '组/库', questionId: '1 #?%' },
  });
  const resolved = router.resolve(route.fullPath);
  assert.equal(resolved.name, 'practice');
  assert.deepEqual(resolved.params, { bankId: '组/库', questionId: '1 #?%' });
});

test(
  'canonical bank URL must not close a drawer the user opened during iframe loading',
  options,
  async (t) => {
    const f = fixture(t);
    await f.open();
    f.controls.loading = { started: deferred(), finish: deferred() };
    await f.navigation.openBank('bank', 'a');
    await f.controls.loading.started.promise;
    f.ui.drawer = 'library';
    f.controls.loading.finish.resolve();
    await until(() => f.router.currentRoute.value.fullPath === '/banks/a/questions/1');
    await nextTick();
    assert.equal(f.ui.drawer, 'library');
  },
);

test(
  'completed summary and question routes preserve their page identity on reload',
  options,
  async (t) => {
    const f = fixture(t);
    f.banks.set('a', 'completed');
    await f.open('/banks/a/summary');
    assert.equal(f.ui.scoreView, true);
    await f.navigation.showQuestion();
    await until(() => f.router.currentRoute.value.name === 'practice');
    assert.equal(f.ui.scoreView, false);
    await f.navigation.showSummary();
    await until(() => f.router.currentRoute.value.name === 'summary');
    assert.equal(f.ui.scoreView, true);
  },
);

test(
  'direct missing bank, unknown page and uncompleted summary recover to an available page',
  options,
  async (t) => {
    const f = fixture(t);
    await f.open('/banks/missing/questions/1');
    await until(() => f.router.currentRoute.value.name === 'library');
    assert.equal(f.practice.current, null);
    assert.equal(f.ui.message, '题库不存在。');
    await f.router.push('/unknown');
    assert.equal(f.router.currentRoute.value.name, 'library');
    await f.router.push('/banks/a/summary');
    await until(() => f.router.currentRoute.value.fullPath === '/banks/a/questions/1');
    assert.equal(f.ui.scoreView, false);
  },
);

test('unauthorized deep link stays available for retry after catalog login', options, async (t) => {
  const f = fixture(t);
  f.controls.catalogError = true;
  await f.open('/banks/a/questions/3');
  assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/questions/3');
  assert.equal(f.practice.current, null);
  f.controls.catalogError = false;
  await f.navigation.catalog();
  assert.equal(f.practice.current.questionId, '3');
});

test(
  'a previous unauthorized response does not block navigation after a save retry succeeds',
  options,
  async (t) => {
    const f = fixture(t);
    await f.open('/banks/a/questions/1');
    // The API keeps the connection form visible after a 401. That flag is not
    // a route permission: subsequent requests still decide their own outcome.
    f.ui.authRequired = true;
    await f.navigation.navigate('2');
    await until(() => f.practice.current.questionId === '2');
    assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/questions/2');
  },
);

test(
  'empty hash ignores legacy last-bank storage, while routing clears the active pane on back to library',
  options,
  async (t) => {
    let accessed = 0;
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem() {
          accessed++;
          return 'a';
        },
        setItem() {
          accessed++;
        },
      },
      configurable: true,
    });
    t.after(() => {
      if (previous) {
        Object.defineProperty(globalThis, 'localStorage', previous);
      } else {
        delete globalThis.localStorage;
      }
    });
    const f = fixture(t);
    await f.open();
    assert.equal(f.practice.current, null);
    await f.navigation.openBank('bank', 'a');
    await until(() => f.router.currentRoute.value.fullPath === '/banks/a/questions/1');
    await f.router.push('/');
    await nextTick();
    assert.equal(f.practice.current, null);
    assert.equal(f.practice.overview, null);
    assert.equal(accessed, 0);
  },
);
