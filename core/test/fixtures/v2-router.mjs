import assert from 'node:assert/strict';
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
      export {createRuntime} from './stores/practice/runtime';
      export {createActions} from './stores/practice/actions';`,
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

export {
  nextTick,
  createRouter,
  createMemoryHistory,
  isNavigationFailure,
  workspaceRoutes,
  deferred,
  until,
  question,
  fixture,
  options,
};
