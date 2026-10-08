import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftFullscreen } from '../web/draft-fullscreen.js';

function fixture({ supported = true, deferred = false } = {}) {
  const listeners = new Set(), changes = [], errors = [];
  let draft = true, requestCount = 0, exitCount = 0, finishEntry;
  const doc = {
    fullscreenEnabled: supported,
    fullscreenElement: null,
    documentElement: {},
    addEventListener(type, handler) { assert.equal(type, 'fullscreenchange'); listeners.add(handler); },
    removeEventListener(type, handler) { assert.equal(type, 'fullscreenchange'); listeners.delete(handler); },
    exitFullscreen() {
      exitCount++;
      doc.fullscreenElement = null;
      emit();
      return Promise.resolve();
    },
  };
  function emit() { for (const handler of [...listeners]) handler(); }
  doc.documentElement.requestFullscreen = options => {
    requestCount++;
    assert.deepEqual(options, { navigationUI: 'hide' });
    if (deferred) return new Promise(resolve => {
      finishEntry = () => { doc.fullscreenElement = doc.documentElement; emit(); resolve(); };
    });
    doc.fullscreenElement = doc.documentElement;
    emit();
    return Promise.resolve();
  };
  const controller = createDraftFullscreen(doc, {
    canEnter: () => draft,
    onChange: state => changes.push(state),
    onError: error => errors.push(error),
  });
  return {
    doc, controller, changes, errors, listeners, emit,
    setDraft(value) { draft = value; },
    finishEntry() { finishEntry(); },
    get requestCount() { return requestCount; },
    get exitCount() { return exitCount; },
  };
}

test('requests fullscreen directly, ignores repeated clicks, and follows browser exits', async () => {
  const f = fixture({ deferred: true });
  const entry = f.controller.toggle();
  assert.equal(f.requestCount, 1, 'entry must run in the caller stack, before any await');
  assert.equal(f.controller.getState().pending, true);
  assert.equal(f.controller.toggle(), entry);
  f.finishEntry();
  assert.equal(await entry, true);
  assert.deepEqual(f.controller.getState(), { supported: true, active: true, pending: false });
  await f.controller.toggle();
  assert.equal(f.exitCount, 1);
  assert.equal(f.controller.getState().active, false);
  const nextEntry = f.controller.toggle();
  f.finishEntry();
  await nextEntry;
  f.doc.fullscreenElement = null;
  f.emit();
  assert.equal(f.controller.getState().active, false);
  assert.equal(f.changes.at(-1).active, false);
  f.controller.destroy();
  assert.equal(f.listeners.size, 0);
});

test('only draft mode may enter; leaving draft exits owned fullscreen', async () => {
  const f = fixture();
  f.setDraft(false);
  await f.controller.toggle();
  assert.equal(f.requestCount, 0);
  f.setDraft(true);
  await f.controller.toggle();
  f.setDraft(false);
  f.controller.sync();
  assert.equal(f.exitCount, 1);
  await Promise.resolve();
  assert.equal(f.controller.getState().active, false);
  // A different fullscreen element must never be exited by this controller.
  f.doc.fullscreenElement = {};
  f.emit();
  f.controller.sync();
  f.doc.fullscreenElement = f.doc.documentElement;
  f.setDraft(true);
  f.emit();
  assert.equal(await f.controller.toggle(), false);
  assert.equal(f.requestCount, 1, 'existing document fullscreen must not be adopted');
  f.controller.destroy();
  assert.equal(f.exitCount, 1);
});

test('pending entry is undone if draft mode changes or the controller is destroyed', async () => {
  for (const destroy of [false, true]) {
    const f = fixture({ deferred: true });
    const entry = f.controller.toggle();
    if (destroy) f.controller.destroy();
    else { f.setDraft(false); f.controller.sync(); }
    f.finishEntry();
    assert.equal(await entry, false);
    assert.equal(f.exitCount, 1);
    assert.deepEqual(f.controller.getState(), { supported: true, active: false, pending: false });
    f.controller.destroy();
    assert.equal(f.listeners.size, 0);
  }
});

test('unsupported and rejected operations report Chinese errors without retaining pending state', async () => {
  const unsupported = fixture({ supported: false });
  await unsupported.controller.toggle();
  assert.equal(unsupported.controller.getState().supported, false);
  assert.equal(unsupported.requestCount, 0);
  assert.match(unsupported.errors[0].message, /不支持全屏/);
  unsupported.controller.destroy();

  for (const immediate of [false, true]) {
    const f = fixture();
    f.doc.documentElement.requestFullscreen = () => {
      const error = new Error('denied');
      if (immediate) throw error;
      return Promise.reject(error);
    };
    assert.equal(await f.controller.toggle(), false);
    assert.deepEqual(f.controller.getState(), { supported: true, active: false, pending: false });
    assert.ok(f.errors[0] instanceof Error);
    assert.match(f.errors[0].message, /无法进入全屏/);
    f.controller.destroy();
  }

  const f = fixture();
  await f.controller.toggle();
  const successfulExit = f.doc.exitFullscreen;
  f.doc.exitFullscreen = () => Promise.reject(new Error('denied'));
  assert.equal(await f.controller.toggle(), false);
  assert.deepEqual(f.controller.getState(), { supported: true, active: true, pending: false });
  assert.match(f.errors[0].message, /无法退出全屏/);
  f.doc.exitFullscreen = successfulExit;
  assert.equal(await f.controller.toggle(), true);
  f.controller.destroy();
});
