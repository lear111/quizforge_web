import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  stdin: {
    contents: `export { createPinia, disposePinia, storeToRefs } from 'pinia';
      export { ref, nextTick } from 'vue';
      export { usePracticeStore } from './stores/practice';
      export { useCatalogStore } from './stores/catalog';
      export { useUiStore } from './stores/ui';
      export { createRuntime } from './stores/runtime';
      export { createActions } from './stores/actions';`,
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
  ref,
  nextTick,
  usePracticeStore,
  useCatalogStore,
  useUiStore,
  createRuntime,
  createActions,
} = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);

const question = (id = 'q1') => ({
  bankId: 'b1',
  questionId: id,
  snapshotId: 's1',
  question: { prompt: 'synthetic' },
  answer: null,
  solution: null,
  result: null,
  ink: { strokes: [1] },
  inkRevision: 0,
  submissionId: null,
  extension: { artifactId: 'single' },
  resources: [],
  item: { questionId: id, label: id, maxScore: 2, children: [] },
  state: {
    questionId: id,
    status: 'unanswered',
    locked: false,
    hasSavedAnswer: false,
    revision: 0,
    maxScore: 2,
  },
});
const overview = (q) => ({
  bank: { bankId: 'b1', title: 'Synthetic' },
  snapshotId: 's1',
  completedAt: null,
  outline: [{ title: 'Group', items: [q.item] }],
  states: [q.state],
  initial: { question: q, error: null },
  pendingGrading: [],
  total: { score: 0, maxScore: 2 },
});

test('Pinia app instances isolate question, catalog, UI and navigation memory', async () => {
  const a = createPinia(),
    b = createPinia();
  try {
    const practice = usePracticeStore(a),
      other = usePracticeStore(b);
    const q = question();
    practice.overview = overview(q);
    practice.update(q);
    practice.remember(q);
    practice.saveStatus = '未保存';
    useUiStore(a).token = 'only-a';
    assert.equal(other.current, null);
    assert.equal(other.overview, null);
    assert.equal(other.saveStatus, '');
    assert.equal(other.lastQuestions.size, 0);
    assert.equal(useUiStore(b).token, '');
    assert.notEqual(useCatalogStore(a), useCatalogStore(b));
    for (let i = 0; i < 10; i++) {
      practice.remember({ ...q, bankId: 'b' + i });
    }
    assert.equal(practice.lastQuestions.size, 8);
    assert.equal(practice.lastQuestions.has('b0'), false);
    practice.overview.completedAt = 'completed';
    await nextTick();
    assert.equal(useUiStore(a).scoreView, true);
    assert.equal(useUiStore(b).scoreView, false);
  } finally {
    disposePinia(a);
    disposePinia(b);
  }
});

test('save responses preserve newer outline status and absent ink; context keeps lock permissions', () => {
  const pinia = createPinia();
  try {
    const practice = usePracticeStore(pinia),
      q = question();
    practice.overview = overview(q);
    practice.update({ ...q, state: { ...q.state, status: 'answered' } });
    const saved = { ...q, answer: 'A', state: { ...q.state, revision: 1 } };
    delete saved.ink;
    delete saved.inkRevision;
    practice.update(saved, true);
    assert.equal(practice.current.state.status, 'answered');
    assert.deepEqual(practice.current.ink, q.ink);
    assert.equal(practice.overview.states[0].revision, 1);
    assert.equal(practice.context(practice.current).can.submit, true);
    practice.update({
      ...practice.current,
      state: { ...practice.current.state, locked: true, hasSavedAnswer: true },
    });
    assert.equal(practice.context(practice.current).can.submit, false);
    assert.equal(practice.context(practice.current).can.retry, true);
    practice.overview.completedAt = 'completed';
    assert.equal(practice.context(practice.current).can.retry, false);
  } finally {
    disposePinia(pinia);
  }
});

test('catalog mapping, collapsed groups and UI busy/error cleanup keep their behavior', async () => {
  const pinia = createPinia();
  try {
    const catalog = useCatalogStore(pinia),
      ui = useUiStore(pinia);
    await catalog.read({
      catalog: {
        get: async () => ({
          groups: [{ id: 'g1', name: 'Group', items: [{ bankId: 'b1', title: 'Bank' }] }],
        }),
      },
    });
    assert.equal(catalog.groups[0].expanded, false);
    assert.equal(catalog.groups[0].children[0].row.id, 'b1');
    catalog.toggleGroup('g1');
    assert.equal(catalog.groups[0].expanded, true);
    let nested = false;
    await ui.run('Opening', async () => {
      assert.equal(ui.busy, true);
      await ui.run('Ignored', async () => {
        nested = true;
      });
      throw Error('synthetic failure');
    });
    assert.equal(nested, false);
    assert.equal(ui.busy, false);
    assert.equal(ui.loading, '');
    assert.equal(ui.message, 'synthetic failure');
  } finally {
    disposePinia(pinia);
  }
});

function navigationFixture() {
  const pinia = createPinia(),
    ui = useUiStore(pinia),
    q = question();
  const ctx = {
    ...storeToRefs(ui),
    overview: ref(overview(q)),
    current: ref(q),
    saveStatus: ref(''),
    recovering: ref(false),
    lastQuestions: ref(new Map()),
    runtime: createRuntime(),
    run: ui.run,
  };
  let actions;
  ctx.actions = () => actions;
  actions = createActions(ctx);
  // Keep the real save controller, queue and navigation. Only the transport
  // and DOM iframe are replaced, so ordering is asserted across actual actions.
  const requests = [],
    shown = [];
  let send, fail;
  const response = new Promise((resolve, reject) => {
    send = resolve;
    fail = reject;
  });
  ctx.api = {
    questions: {
      prepareAnswer: () => ({ route: '/save', body: 'stable-request' }),
      sendSave: () => {
        requests.push('save');
        return response;
      },
      get: async () => {
        requests.push('get');
        return question('q2');
      },
    },
  };
  const instance = {
    answer: async () => 'A',
    can: { retry: true },
    frame: {},
    update: async () => {},
    destroy() {},
  };
  ctx.runtime.saver = actions.createSaver(q, 0, instance);
  ctx.runtime.answerVersion = 1;
  actions.show = async (value) => {
    shown.push(value.questionId);
    actions.update(value);
  };
  return {
    ctx,
    actions,
    requests,
    shown,
    send,
    fail,
    dispose() {
      ctx.runtime.saver.destroy();
      disposePinia(pinia);
    },
  };
}

test('navigation waits for the real pending save and write queue before requesting next question', async (t) => {
  // Save controller uses the window timer API; no actual timed wait is needed.
  const previous = globalThis.window;
  globalThis.window = { setTimeout: () => 1, clearTimeout() {} };
  t.after(() => {
    globalThis.window = previous;
  });
  const f = navigationFixture();
  try {
    f.ctx.runtime.saver.changed('text');
    const navigation = f.actions.navigate('q2');
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    assert.deepEqual(f.requests, ['save']);
    assert.equal(f.ctx.current.value.questionId, 'q1');
    assert.deepEqual(f.shown, []);
    f.send({ ...question(), answer: 'A', state: { ...question().state, hasSavedAnswer: true } });
    await navigation;
    assert.deepEqual(f.requests, ['save', 'get']);
    assert.deepEqual(f.shown, ['q2']);
  } finally {
    f.dispose();
  }
});

test('failed pending save keeps current input and prevents next-question loading until retry', async (t) => {
  const previous = globalThis.window;
  globalThis.window = { setTimeout: () => 1, clearTimeout() {} };
  t.after(() => {
    globalThis.window = previous;
  });
  const f = navigationFixture();
  try {
    f.ctx.runtime.saver.changed('text');
    const navigation = f.actions.navigate('q2');
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    f.fail(Error('network unavailable'));
    await navigation;
    assert.deepEqual(f.requests, ['save']);
    assert.equal(f.ctx.current.value.questionId, 'q1');
    assert.equal(f.ctx.runtime.saver.dirty, true);
    assert.equal(f.ctx.saveStatus.value, '保存失败');
    assert.equal(f.ctx.message.value, 'network unavailable');
    assert.deepEqual(f.shown, []);
  } finally {
    f.dispose();
  }
});
