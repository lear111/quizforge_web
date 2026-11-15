import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  nextTick,
  isNavigationFailure,
  deferred,
  until,
  question,
  fixture,
  options,
} from '../fixtures/v2-router.mjs';

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

test(
  'canonical bank URL must not close a drawer the user opened during iframe loading',
  options,
  async (t) => {
    const f = fixture(t);
    await f.open();
    f.controls.loading = { started: deferred(), finish: deferred() };
    const pending = f.navigation.openBank('bank', 'a');
    await f.controls.loading.started.promise;
    f.ui.drawer = 'library';
    f.controls.loading.finish.resolve();
    await pending;
    await until(() => f.router.currentRoute.value.fullPath === '/banks/a/questions/1');
    await nextTick();
    assert.equal(f.ui.drawer, 'library');
  },
);

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
  'a direct second navigation during iframe loading cannot leave the address on the old question',
  options,
  async (t) => {
    const f = fixture(t);
    await f.open('/banks/a/questions/1');
    f.controls.loading = { started: deferred(), finish: deferred() };
    const first = f.router.push('/banks/a/questions/2');
    await f.controls.loading.started.promise;
    const second = f.router.push('/banks/a/questions/3');
    await nextTick();
    f.controls.loading.finish.resolve();
    await Promise.all([first, second]);
    assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/questions/2');
    assert.equal(f.practice.current.questionId, '2');
    assert.equal(f.requests.includes('get:a:3'), false);
  },
);

for (const fails of [false, true]) {
  test(
    `current summary waits for saving and ${fails ? 'keeps the question on failure' : 'never locks on entry'}`,
    options,
    async (t) => {
      const f = fixture(t);
      await f.open('/banks/a/questions/1');
      f.dirty();
      const navigation = f.navigation.showSummary();
      await f.controls.sent.promise;
      assert.equal(f.router.currentRoute.value.fullPath, '/banks/a/questions/1');
      assert.equal(f.ui.scoreView, false);
      if (fails) {
        f.controls.save.reject(Error('summary save failed'));
      } else {
        f.controls.save.resolve({ ...question('a', '1'), answer: 'B' });
      }
      await navigation;
      assert.equal(f.ui.scoreView, !fails);
      assert.equal(
        f.router.currentRoute.value.fullPath,
        fails ? '/banks/a/questions/1' : '/banks/a/summary',
      );
      assert.equal(f.practice.current.questionId, '1');
      assert.equal(f.practice.current.submissionId, null);
      assert.equal(f.practice.overview.completedAt, null);
      assert.equal(f.ctx.runtime.saver.dirty, fails);
      assert.deepEqual(f.requests, ['overview:a', 'save']);
    },
  );
}
