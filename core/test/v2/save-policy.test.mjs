import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../../frontend/src/v2/save-policy.ts', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'SavePolicy' });
const dom = new JSDOM('', { runScripts: 'outside-only' }); dom.window.eval(bundle.outputFiles[0].text + ';window.Policy=SavePolicy;');
const { createSaveController, SAVE_DELAYS, attachSaveLifecycle } = dom.window.Policy;
function clock() {
  let now = 0, id = 0; const tasks = new Map();
  return { setTimeout(fn, ms) { tasks.set(++id, { fn, at: now + ms }); return id; }, clearTimeout(id) { tasks.delete(id); },
    async tick(ms) { const until = now + ms; for (;;) { const next = [...tasks].filter(([, v]) => v.at <= until).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; tasks.delete(next[0]); now = next[1].at; next[1].fn(); for (let i = 0; i < 12; i++) await Promise.resolve(); } now = until; } };
}
test('four delays are centralized; choice is immediate, text and ink wait their idle interval', async () => {
  assert.deepEqual(JSON.parse(JSON.stringify(SAVE_DELAYS)), { choice: 0, text: 1000, ink: 1500, maxWait: 10000 });
  for (const [kind, delay] of [['choice', 0], ['text', 1000], ['ink', 1500]]) {
    const time = clock(), calls = []; const saver = createSaveController({ clock: time, read: async () => kind, prepare: value => async () => calls.push(value) });
    saver.changed(kind); if (delay) { await time.tick(delay - 1); assert.equal(calls.length, 0); }
    await time.tick(delay ? 1 : 0); assert.deepEqual(calls, [kind]); assert.equal(saver.dirty, false); saver.destroy();
  }
});
test('continuous typing and ink save within ten seconds counted from first dirty input', async () => {
  for (const kind of ['text', 'ink']) {
    const time = clock(); let calls = 0, value = 0;
    const saver = createSaveController({ clock: time, read: async () => value, prepare: () => async () => { calls++; } });
    saver.changed(kind); for (let i = 0; i < 19; i++) { await time.tick(500); value++; saver.changed(kind); }
    assert.equal(calls, 0); await time.tick(500); assert.equal(calls, 1); assert.equal(saver.dirty, false); saver.destroy();
  }
});
test('failure retries the exact prepared operation before saving newer input; overlapping flushes serialize', async () => {
  const time = clock(), attempts = [], prepared = []; let value = 'A', fail = true;
  const saver = createSaveController({ clock: time, read: async () => value, prepare: data => { const op = { id: prepared.length, data }; prepared.push(op); return async () => { attempts.push(op); if (fail) throw Error('offline'); }; } });
  saver.changed('text'); await assert.rejects(saver.flush(), /offline/); assert.equal(saver.dirty, true);
  value = 'B'; saver.changed('text'); fail = false;
  await Promise.all([saver.flush(), saver.flush()]); assert.equal(attempts[0], attempts[1]); assert.deepEqual(prepared.map(x => x.data), ['A', 'B']); assert.equal(attempts.length, 3); assert.equal(saver.dirty, false); saver.destroy();
});
test('new input during an in-flight save remains dirty until its own save completes', async () => {
  let value = 'A', release; const seen = [];
  const saver = createSaveController({ read: async () => value, prepare: data => async () => { seen.push(data); if (data === 'A') await new Promise(resolve => { release = resolve; }); } });
  saver.changed('text'); const flushing = saver.flush(); for (let i = 0; i < 5; i++) await Promise.resolve(); value = 'B'; saver.changed('text'); release(); await flushing;
  assert.deepEqual(seen, ['A', 'B']); assert.equal(saver.dirty, false); saver.destroy();
});
test('unload warns only with unsaved input; hidden flushes now and teardown removes listeners/timers', async () => {
  const win = new JSDOM('', { url: 'http://localhost/' }).window, time = clock(); let saves = 0;
  const saver = createSaveController({ clock: time, read: async () => 1, prepare: () => async () => { saves++; } });
  const detach = attachSaveLifecycle(win, saver);
  const event = () => { const e = new win.Event('beforeunload', { cancelable: true }); win.dispatchEvent(e); return e; };
  assert.equal(event().defaultPrevented, false); saver.changed('text'); assert.equal(event().defaultPrevented, true);
  Object.defineProperty(win.document, 'visibilityState', { value: 'hidden' }); win.document.dispatchEvent(new win.Event('visibilitychange'));
  await saver.flush(); assert.equal(saves, 1); assert.equal(event().defaultPrevented, false);
  saver.changed('text'); detach(); saver.destroy(); await time.tick(10000); assert.equal(saves, 1); assert.equal(event().defaultPrevented, false); win.close();
});
