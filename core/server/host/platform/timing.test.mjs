import test from 'node:test';
import assert from 'node:assert/strict';
import { Timing, withTiming, timed, startTiming, timingHeader } from './timing.js';
import { SerialTransactions, LoadCoordinator } from './transactions.js';
import { cloneJson, parseJson, stringifyJson } from './json.js';

test('exclusive wall time partitions nested and overlapping spans without double counting', () => {
  let now = 0; const timing = new Timing(() => now);
  withTiming(timing, () => {
    const library = startTiming('library'); now = 2;
    const rules = startTiming('rules'); now = 3;
    const clone = startTiming('clone'); now = 5; clone();
    now = 7; rules(); now = 10; library(); now = 12;
    assert.deepEqual(timing.values(), { library: 5, 'state-load': 0, rules: 3, clone: 2, persist: 0, queue: 0, 'response-json': 0, other: 2, total: 12 });
    assert.match(timingHeader(), /clone;dur=2\.000/);
  });
});

test('parallel intervals use their union; completed headers ignore late background work', () => {
  let now = 0; const timing = new Timing(() => now);
  withTiming(timing, () => {
    const first = startTiming('rules'); now = 2;
    const second = startTiming('rules'); now = 5; first(); now = 8; second();
    assert.equal(timing.values().rules, 8);
    const late = startTiming('library'); const header = timingHeader(); now = 20; late();
    assert.match(header, /total;dur=8\.000/);
  });
});

test('timing preserves sync values, throws, async rejection and numeric source metadata', async () => {
  assert.equal(timed('clone', () => 4), 4);
  const timing = new Timing();
  await withTiming(timing, async () => {
    assert.throws(() => timed('clone', () => { throw Error('sync'); }), /sync/);
    await assert.rejects(timed('rules', async () => { throw Error('async'); }), /async/);
    assert.equal(stringifyJson(cloneJson(parseJson('{"value":1.0}'))), '{"value":1.0}');
    assert.ok(timing.values().clone > 0);
  });
});

test('request contexts are isolated and queue measures only waiting, excluding reentrant work', async () => {
  const queue = new SerialTransactions(); let release, entered;
  const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve);
  const first = queue.run(async () => { entered(); await gate; }); await started;
  const waiting = new Timing(), independent = new Timing();
  const second = withTiming(waiting, () => queue.run(() => queue.run(() => cloneJson({ a: 1 }))));
  withTiming(independent, () => cloneJson({ b: 2 }));
  release(); await Promise.all([first, second]);
  assert.ok(waiting.values().queue > 0); assert.ok(waiting.values().clone > 0);
  assert.equal(independent.values().queue, 0);
});

test('a load queued behind another request attributes its rules to the submitting request', async () => {
  const coordinator = new LoadCoordinator(), first = new Timing(), second = new Timing(); let release;
  const gate = new Promise(resolve => release = resolve);
  const a = withTiming(first, () => coordinator.submit('a', true, () => gate));
  const b = withTiming(second, () => coordinator.submit('b', true, () => timed('rules', () => cloneJson({ value: 1 }))));
  release(); await Promise.all([a, b]); coordinator.close();
  assert.equal(first.values().rules, 0); assert.equal(first.values().clone, 0);
  assert.ok(second.values().rules > 0); assert.ok(second.values().clone > 0);
});

test('diagnostic binding preserves the coordinator callback receiver', async () => {
  const coordinator = new LoadCoordinator();
  assert.equal(await coordinator.submit('receiver', true, function () { return this.key; }), 'receiver');
  coordinator.close();
});
