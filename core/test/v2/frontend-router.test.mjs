import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  nextTick,
  createRouter,
  createMemoryHistory,
  workspaceRoutes,
  until,
  fixture,
  options,
} from '../fixtures/v2-router.mjs';

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
  'direct missing bank and unknown page recover; an active practice can open its current summary',
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
    await until(() => f.router.currentRoute.value.fullPath === '/banks/a/summary');
    assert.equal(f.ui.scoreView, true);
    assert.equal(f.practice.overview.completedAt, null);
    assert.equal(f.practice.current.questionId, '1');
    await f.navigation.showQuestion();
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
